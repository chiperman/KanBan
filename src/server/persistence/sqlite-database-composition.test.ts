import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";
import { openSqliteDashboard } from "./sqlite-database-composition";
import { SqliteTransactionStore } from "./sqlite-transaction-store";

const capturedAt = "2026-10-01T01:00:00.000Z";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-sqlite-composition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return [
    path.join(root, "data.sqlite"),
    path.join(root, "absent.json"),
    path.join(root, "absent-cards.json"),
  ] as const;
}

test("SQLite 组合根配置连接并让读写模块共享同一事务", async (t) => {
  const paths = await fixture(t);
  const { database, transactions, manualSources, readModel, cards } = openSqliteDashboard(...paths);
  try {
    assert.equal(database.prepare("PRAGMA busy_timeout").get()?.timeout, 5000);
    assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.equal(database.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(database.prepare("PRAGMA synchronous").get()?.synchronous, 2);
    assert.equal((await stat(paths[0])).mode & 0o777, 0o600);
    assert.throws(() => transactions.run(() => {
      manualSources.createManual({ label: "回滚来源" }, capturedAt);
      assert.equal(readModel.listSourcesSync()[0].label, "回滚来源");
      assert.equal(cards.list().length, 1);
      throw new Error("fixture composition rollback");
    }), /fixture composition rollback/);
    assert.deepEqual(readModel.listSourcesSync(), []);
    assert.deepEqual(cards.list(), []);
    transactions.run(() => manualSources.createManual({ label: "保留来源" }, capturedAt));
    assert.equal(readModel.listSourcesSync()[0].label, "保留来源");
    transactions.assertIntegrity();
  } finally {
    database.close();
  }

  const reopened = new SqliteDashboardDatabase(...paths);
  const connection = (reopened as unknown as { database: DatabaseSync }).database;
  try {
    assert.equal((await reopened.listSources())[0].label, "保留来源");
    assert.equal((await reopened.listAssetCards()).length, 1);
  } finally {
    connection.close();
  }
});

test("SQLite 适配器初始化失败关闭组合根连接并保留启动错误", async (t) => {
  const paths = await fixture(t);
  const seed = new DatabaseSync(paths[0]);
  seed.exec("CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
  seed.exec("INSERT INTO schema_metadata VALUES ('schema_version', '999')");
  seed.close();
  const closed: DatabaseSync[] = [];
  const close = DatabaseSync.prototype.close;
  t.mock.method(DatabaseSync.prototype, "close", function (this: DatabaseSync) {
    closed.push(this);
    close.call(this);
  });

  assert.throws(() => new SqliteDashboardDatabase(...paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /SQLite 业务数据初始化失败/);
    assert.ok(error.message.includes(paths[0]));
    assert.match(error.message, /不支持的 SQLite schema 版本: 999/);
    assert.ok(error.cause instanceof Error);
    return true;
  });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].isOpen, false);
  t.mock.restoreAll();
  const check = new DatabaseSync(paths[0]);
  try {
    assert.equal(check.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get()?.value, "999");
  } finally {
    check.close();
  }
});

test("SQLite 组合根完整性检查失败时关闭连接，清理异常不掩盖原始错误", async (t) => {
  const paths = await fixture(t);
  const failure = new Error("fixture startup integrity failure");
  const closed: DatabaseSync[] = [];
  const close = DatabaseSync.prototype.close;
  t.mock.method(SqliteTransactionStore.prototype, "assertIntegrity", () => { throw failure; });
  t.mock.method(DatabaseSync.prototype, "close", function (this: DatabaseSync) {
    closed.push(this);
    close.call(this);
    throw new Error("fixture cleanup failure");
  });
  assert.throws(() => openSqliteDashboard(...paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, failure);
    assert.match(error.message, /fixture startup integrity failure/);
    assert.doesNotMatch(error.message, /fixture cleanup failure/);
    return true;
  });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].isOpen, false);
  t.mock.restoreAll();
  const reopened = openSqliteDashboard(...paths);
  try {
    assert.deepEqual(reopened.readModel.listSourcesSync(), []);
  } finally {
    reopened.database.close();
  }
});
