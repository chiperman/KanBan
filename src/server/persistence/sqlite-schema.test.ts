import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DashboardSchema } from "./sqlite-schema";

function createSchema(database: DatabaseSync): void {
  const transaction = <T>(operation: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const metadata = (key: string): string | null => {
    const row = database
      .prepare("SELECT value FROM schema_metadata WHERE key = ?")
      .get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  };
  new DashboardSchema(database, transaction, metadata).createSchema();
}

test("SQLite Schema 首次建表写入当前版本且重复初始化幂等", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-schema-"));
  const database = new DatabaseSync(path.join(root, "data.sqlite"));
  try {
    createSchema(database);
    assert.equal(
      (database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as { value: string }).value,
      "20",
    );
    const tablesBefore = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    createSchema(database);
    const tablesAfter = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    assert.deepEqual(tablesAfter, tablesBefore);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Schema 将 19 版迁移到当前版本并拒绝未知版本", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-schema-version-"));
  const database = new DatabaseSync(path.join(root, "data.sqlite"));
  try {
    database.exec("CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
    database.prepare("INSERT INTO schema_metadata VALUES ('schema_version', '19')").run();
    createSchema(database);
    assert.equal(
      (database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as { value: string }).value,
      "20",
    );
    database.prepare("UPDATE schema_metadata SET value = '999' WHERE key = 'schema_version'").run();
    assert.throws(() => createSchema(database), /不支持的 SQLite schema 版本: 999/);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
