import assert from "node:assert/strict";
import test from "node:test";
import type {
  AssetFullRefreshStateDatabase,
  FormalDailySettlementDatabase,
  FormalSettlementExecutionDatabase,
} from "./contracts";
import type { FormalDailySettlement, FormalSettlementExecution } from "@/server/ports";
import {
  DatabaseAssetFullRefreshState,
  DatabaseFormalDailySettlements,
  DatabaseFormalSettlementExecutions,
} from "./adapters";

const capturedAt = "2026-10-01T01:00:00.000Z";

test("刷新状态适配器只依赖最小接口，保留参数、预占结果与失败", async () => {
  const calls: unknown[][] = [];
  const state = { attemptedAt: capturedAt, inProgressAt: null };
  let claimResult: Awaited<ReturnType<AssetFullRefreshStateDatabase["claimAssetFullRefresh"]>> = "claimed";
  const failure = new Error("fixture refresh state failure");
  const database: AssetFullRefreshStateDatabase = {
    async readAssetFullRefreshState() { return state; },
    async initializeAssetFullRefresh(at) {
      calls.push(["initialize", at]);
      return at === capturedAt;
    },
    async claimAssetFullRefresh(input) {
      calls.push(["claim", input]);
      return claimResult;
    },
    async startAssetFullRefresh(at) { calls.push(["start", at]); },
    async finishAssetFullRefresh(at) { calls.push(["finish", at]); },
    async clearAssetFullRefresh() { throw failure; },
  };
  const adapter = new DatabaseAssetFullRefreshState(database);
  assert.equal(await adapter.read(), state);
  assert.equal(await adapter.initialize(capturedAt), true);
  assert.equal(await adapter.initialize("2026-10-02T01:00:00.000Z"), false);
  const claim = { attemptedAt: capturedAt, intervalMs: 60_000, staleAfterMs: 120_000, force: true };
  for (const result of ["claimed", "not-due", "in-progress"] as const) {
    claimResult = result;
    assert.equal(await adapter.claim(claim), result);
  }
  await adapter.start(capturedAt);
  await adapter.finish(capturedAt);
  await adapter.finish();
  await assert.rejects(adapter.clear(), (error: unknown) => error === failure);
  assert.deepEqual(calls, [
    ["initialize", capturedAt],
    ["initialize", "2026-10-02T01:00:00.000Z"],
    ["claim", claim], ["claim", claim], ["claim", claim],
    ["start", capturedAt], ["finish", capturedAt], ["finish", undefined],
  ]);
});

test("正式日结适配器通过最小接口保留读取、幂等结果与错误", async () => {
  const settlement: FormalDailySettlement = {
    anchor: {
      key: "crypto-cutoff:2026-10-01",
      kind: "crypto-cutoff",
      market: null,
      tradingDay: "2026-10-01",
      scheduledCloseAt: "2026-10-01T16:00:00.000Z",
    },
    capturedAt,
    status: "incomplete",
    diagnostic: "fixture",
    total: { USD: "10", CNY: null, HKD: null },
    exchangeRates: [], sources: [], holdings: [],
  };
  const saved: FormalDailySettlement[] = [];
  const failure = new Error("fixture settlement failure");
  let rejectWrite = false;
  const database: FormalDailySettlementDatabase = {
    async listFormalDailySettlements() { return saved; },
    async recordFormalDailySettlementIfAbsent(input) {
      assert.equal(input, settlement);
      if (rejectWrite) throw failure;
      if (saved.length) return false;
      saved.push(input);
      return true;
    },
  };
  const adapter = new DatabaseFormalDailySettlements(database);
  assert.equal(await adapter.list(), saved);
  assert.equal(await adapter.recordIfAbsent(settlement), true);
  assert.equal(await adapter.recordIfAbsent(settlement), false);
  assert.deepEqual(await adapter.list(), [settlement]);
  rejectWrite = true;
  await assert.rejects(adapter.recordIfAbsent(settlement), (error: unknown) => error === failure);
});

test("日结执行记录适配器不依赖 SQLite 类，保留空值、记录与失败", async () => {
  const execution: FormalSettlementExecution = {
    startedAt: capturedAt,
    finishedAt: "2026-10-01T01:01:00.000Z",
    outcome: "not-due",
    reason: "before-window",
    settlementStatus: null,
  };
  let saved: FormalSettlementExecution | null = null;
  let rejectWrite = false;
  const failure = new Error("fixture execution failure");
  const database: FormalSettlementExecutionDatabase = {
    async latestFormalSettlementExecution() { return saved; },
    async recordFormalSettlementExecution(input) {
      assert.equal(input, execution);
      if (rejectWrite) throw failure;
      saved = input;
    },
  };
  const adapter = new DatabaseFormalSettlementExecutions(database);
  assert.equal(await adapter.latest(), null);
  await adapter.record(execution);
  assert.equal(await adapter.latest(), execution);
  rejectWrite = true;
  await assert.rejects(adapter.record(execution), (error: unknown) => error === failure);
  assert.equal(await adapter.latest(), execution);
});
