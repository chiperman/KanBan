import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { FormalSettlementExecution } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";

const earlier: FormalSettlementExecution = {
  startedAt: "2026-10-01T00:00:00.000Z",
  finishedAt: "2026-10-01T00:00:01.000Z",
  outcome: "waiting",
  reason: "official-close-pending",
  settlementStatus: null,
};

const later: FormalSettlementExecution = {
  startedAt: "2026-10-01T00:15:00.000Z",
  finishedAt: "2026-10-01T00:15:01.000Z",
  outcome: "recorded",
  reason: null,
  settlementStatus: "complete",
};

async function fixture(
  run: (database: SqliteDashboardDatabase, sql: DatabaseSync) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-settlement-execution-"));
  const database = new SqliteDashboardDatabase(
    path.join(root, "data.sqlite"),
    path.join(root, "absent.json"),
    path.join(root, "absent-cards.json"),
  );
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    await run(database, sql);
  } finally {
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("正式日结执行记录按开始时间单调更新，较早完成不覆盖较新结果", async () => {
  await fixture(async (database) => {
    await database.recordFormalSettlementExecution(later);
    await database.recordFormalSettlementExecution(earlier);
    assert.deepEqual(await database.latestFormalSettlementExecution(), later);
    await database.recordFormalSettlementExecution({ ...later, finishedAt: "2026-10-01T00:15:02.000Z" });
    assert.deepEqual(await database.latestFormalSettlementExecution(), {
      ...later,
      finishedAt: "2026-10-01T00:15:02.000Z",
    });
  });
});

test("正式日结执行记录写入失败时事务回滚，不破坏既有最近结果", async () => {
  await fixture(async (database, sql) => {
    await database.recordFormalSettlementExecution(earlier);
    sql.exec(`CREATE TRIGGER reject_settlement_execution
      BEFORE UPDATE ON formal_settlement_execution
      BEGIN SELECT RAISE(ABORT, 'fixture settlement execution failure'); END;`);
    await assert.rejects(
      database.recordFormalSettlementExecution(later),
      /fixture settlement execution failure/,
    );
    assert.deepEqual(await database.latestFormalSettlementExecution(), earlier);
    sql.exec("DROP TRIGGER reject_settlement_execution");
    await database.recordFormalSettlementExecution(later);
    assert.deepEqual(await database.latestFormalSettlementExecution(), later);
  });
});
