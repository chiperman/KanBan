import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { InvestmentCashflow } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";

const capturedAt = "2026-10-01T01:00:00.000Z";

function cashflow(id: string, amount: string): InvestmentCashflow {
  return {
    id,
    kind: id === "initial" ? "initial-investment" : "external-deposit",
    occurredAt: "2026-09-30T00:00:00.000Z",
    amount,
    currency: "USD",
    note: id,
    amounts: { USD: amount, CNY: null, HKD: null },
    exchangeRates: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

test("资金账本写入、更新、删除委托到独立模块并保持排序与换算证据", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-cashflow-store-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    await database.createInvestmentCashflow(cashflow("initial", "100"));
    await database.createInvestmentCashflow(cashflow("deposit", "25"));
    assert.deepEqual(
      (await database.listInvestmentCashflows()).map(({ id, amount }) => ({ id, amount })),
      [{ id: "initial", amount: "100" }, { id: "deposit", amount: "25" }],
    );
    await database.updateInvestmentCashflow({
      ...cashflow("deposit", "30"),
      note: "updated",
      updatedAt: "2026-10-01T02:00:00.000Z",
    });
    assert.deepEqual((await database.listInvestmentCashflows())[1], {
      ...cashflow("deposit", "30"),
      note: "updated",
      updatedAt: "2026-10-01T02:00:00.000Z",
    });
    await database.deleteInvestmentCashflow("deposit");
    assert.deepEqual(await database.listInvestmentCashflows(), [cashflow("initial", "100")]);
    await assert.rejects(database.deleteInvestmentCashflow("missing"), /不存在/);
  } finally {
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("资金账本更新失败时事务回滚，既有金额与换算证据保持不变", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-cashflow-rollback-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    const original = cashflow("initial", "100");
    await database.createInvestmentCashflow(original);
    sql.exec(`CREATE TRIGGER reject_cashflow_update
      BEFORE UPDATE ON investment_cashflows
      BEGIN SELECT RAISE(ABORT, 'fixture cashflow failure'); END;`);
    await assert.rejects(
      database.updateInvestmentCashflow({ ...original, amount: "200", amounts: { USD: "200", CNY: null, HKD: null } }),
      /fixture cashflow failure/,
    );
    assert.deepEqual(await database.listInvestmentCashflows(), [original]);
    sql.exec("DROP TRIGGER reject_cashflow_update");
    await database.updateInvestmentCashflow({ ...original, amount: "200", amounts: { USD: "200", CNY: null, HKD: null } });
    assert.equal((await database.listInvestmentCashflows())[0].amount, "200");
  } finally {
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});
