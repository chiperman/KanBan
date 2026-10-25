import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SourceIsolatedAssetSynchronization } from "./asset-synchronization";
import { DatabaseAssetFullRefreshState, DatabaseAssetSources, DatabaseDailyAssetSnapshots } from "./persistence/adapters";
import { SqliteDashboardDatabase } from "./persistence/sqlite-database";
import type { AssetSourceSummary } from "./ports";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-daily-trend-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  t.after(async () => {
    (database as unknown as { database: DatabaseSync }).database.close();
    await rm(root, { recursive: true, force: true });
  });
  let now = "2026-10-02T01:00:00.000Z";
  const amounts: Record<string, string> = { alpha: "100", beta: "200" };
  const failures = new Set<string>();
  const sources: AssetSourceSummary[] = ["alpha", "beta"].map(id => ({
    id, kind: id === "alpha" ? "longbridge" : "binance", label: id, accountId: id,
    permissions: [], credentialReference: "fixture-" + id,
    snapshot: { total: { amount: amounts[id], currency: "USD" }, holdings: [], syncedAt: now,
      exchangeRates: id === "alpha" ? [
        { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7", source: "fixture", observedAt: now },
        { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "fixture", observedAt: now },
      ] : [],
    },
    sync: { status: "current", lastSuccessfulAt: now, lastAttemptAt: now, error: null },
  }));
  await database.replaceSources(sources);
  const snapshots = new DatabaseDailyAssetSnapshots(database);
  const synchronization = new SourceIsolatedAssetSynchronization(
    new DatabaseAssetSources(database), {
      get: async () => "fixture", put: async () => "fixture",
      replace: async () => {}, remove: async () => {},
    },
    { now: () => new Date(now) }, {
      async refresh({ source, attemptedAt }) {
        if (failures.has(source.id)) throw new Error("fixture unavailable");
        return { snapshot: { ...source.snapshot, syncedAt: attemptedAt,
          total: { amount: amounts[source.id], currency: "USD" } } };
      },
    }, 1_000, snapshots, new DatabaseAssetFullRefreshState(database),
  );
  return { database, snapshots, amounts, failures, synchronization,
    advance: (value: string) => { now = value; },
    async addManual() {
      await database.createManualAssetSource({ label: "手工" }, now);
      const manual = (await database.listSources()).find(source => source.kind === "manual")!;
      await database.recordManualAssetSource(manual.id, { day: "2026-10-02", amount: "50", currency: "USD" }, now);
      return manual.id;
    },
  };
}

test("SQLite 同日断开后全量观测移除旧来源，手工增量保留其余观测和当日基准", async t => {
  const state = await fixture(t);
  await state.synchronization.request({ intent: { reason: "manual-global" } });
  const manualId = await state.addManual();
  await state.database.disconnectAssetSource("beta");
  state.advance("2026-10-02T02:00:00.000Z");
  state.amounts.alpha = "110";
  await state.synchronization.request({ intent: { reason: "manual-global" } });
  let [trend] = await state.snapshots.listTrendObservations();
  assert.deepEqual(trend.sources.map(source => source.sourceId).sort(), ["alpha", manualId].sort());
  assert.equal(trend.total.USD, "160");
  assert.equal(trend.status, "complete");
  assert.equal((await state.database.listSources()).find(source => source.id === "beta")?.snapshot.total.amount, "200", "断开继续保留当前来源金额");
  await state.database.recordManualAssetSource(manualId, { day: "2026-10-02", amount: "70", currency: "USD" }, "2026-10-02T03:00:00.000Z");
  [trend] = await state.snapshots.listTrendObservations();
  assert.equal(trend.total.USD, "180");
  assert.equal(trend.sources.find(source => source.sourceId === "alpha")?.capturedAt, "2026-10-02T02:00:00.000Z");
  assert.equal((await state.snapshots.list())[0].total.USD, "300", "当天基准不得被断开或手工编辑改写");
});

test("SQLite 部分失败保留成功来源并更新新成功值，手工增量独立且恢复后更新", async t => {
  const state = await fixture(t);
  await state.synchronization.request({ intent: { reason: "manual-global" } });
  const manualId = await state.addManual();
  state.advance("2026-10-02T02:00:00.000Z");
  state.amounts.alpha = "110";
  state.failures.add("beta");
  assert.equal((await state.synchronization.request({ intent: { reason: "manual-global" } })).failureCount, 1);
  let [trend] = await state.snapshots.listTrendObservations();
  assert.equal(trend.total.USD, "360");
  assert.equal(trend.status, "complete");
  assert.equal(trend.sources.find(source => source.sourceId === "alpha")?.total.USD, "110");
  await state.database.recordManualAssetSource(manualId, { day: "2026-10-02", amount: "70", currency: "USD" }, "2026-10-02T03:00:00.000Z");
  [trend] = await state.snapshots.listTrendObservations();
  assert.equal(trend.total.USD, "380");
  assert.equal(trend.status, "complete");
  state.failures.clear();
  state.amounts.beta = "220";
  state.advance("2026-10-02T04:00:00.000Z");
  await state.synchronization.request({ intent: { reason: "manual-global" } });
  [trend] = await state.snapshots.listTrendObservations();
  assert.equal(trend.total.USD, "400");
  assert.equal(trend.status, "complete");
  assert.equal((await state.snapshots.list())[0].total.USD, "300");
});
