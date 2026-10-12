import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteTransactionStore } from "./sqlite-transaction-store";

test("SQLite 事务模块提交成功、失败回滚并加固数据库文件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-transaction-store-"));
  const databasePath = path.join(root, "data.sqlite");
  const database = new DatabaseSync(databasePath);
  const transactions = new SqliteTransactionStore(database, databasePath);
  try {
    database.exec("CREATE TABLE values_table (value TEXT NOT NULL) STRICT");
    transactions.run(() => database.prepare("INSERT INTO values_table VALUES (?)").run("committed"));
    assert.deepEqual(
      (database.prepare("SELECT value FROM values_table").all() as { value: string }[])
        .map(({ value }) => value),
      ["committed"],
    );
    await chmod(databasePath, 0o644);
    assert.throws(
      () => transactions.run(() => {
        database.prepare("INSERT INTO values_table VALUES (?)").run("rolled-back");
        throw new Error("fixture transaction failure");
      }),
      /fixture transaction failure/,
    );
    assert.deepEqual(
      (database.prepare("SELECT value FROM values_table").all() as { value: string }[])
        .map(({ value }) => value),
      ["committed"],
    );
    await chmod(databasePath, 0o644);
    transactions.run(() => undefined);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    transactions.assertIntegrity();
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
