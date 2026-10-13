import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DatabaseAssetSourceLifecycle } from "@/server/source-connections";
import type { DashboardDatabase } from "@/server/persistence/contracts";
import type { AssetFullRefreshState, AssetSourceSummary, SecretStore } from "@/server/ports";
import type { TransactionalSecretStore } from "@/server/credentials/secret-store";
import { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";

function source(): AssetSourceSummary {
  return {
    id: "ethereum",
    kind: "evm-watch-ethereum",
    label: "Ethereum 观察钱包",
    accountId: "ethereum:test",
    permissions: ["public-address"],
    credentialReference: "secret-reference",
    sync: {
      status: "current",
      lastSuccessfulAt: "2026-09-20T00:00:00.000Z",
      lastAttemptAt: "2026-09-20T00:00:00.000Z",
      error: null,
    },
    snapshot: {
      total: { amount: "100", currency: "USD" },
      holdings: [{
        symbol: "ETH",
        name: "Ethereum",
        sourceAsset: "evm:1:native",
        quantity: "0.05",
        currency: "USD",
        assetClass: "crypto",
        currentPrice: { amount: "2000", currency: "USD" },
        marketValue: "100",
        sourceMarketValue: { amount: "100", currency: "USD" },
        valuation: {
          status: "valued",
          priceSource: "CoinGecko",
          pricedAt: "2026-09-20T00:00:00.000Z",
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [],
      syncedAt: "2026-09-20T00:00:00.000Z",
    },
  };
}

test("设置 EVM 偏好不会用旧来源覆盖并发刷新的最新快照", async () => {
  let current = source();
  let updateSourceCalls = 0;
  const database = {
    listSources: async () => [current],
    setAssetSourceEvmTokenPreferences: async (
      sourceId: string,
      ignoredAssetKeys: string[],
      includedAssetKeys: string[],
    ) => {
      assert.equal(sourceId, "ethereum");
      current = {
        ...current,
        ignoredAssetKeys,
        includedAssetKeys,
        snapshot: {
          ...current.snapshot,
          total: { amount: "125", currency: "USD" },
          syncedAt: "2026-09-21T00:00:00.000Z",
        },
      };
    },
    updateSource: async () => {
      updateSourceCalls += 1;
    },
  } as unknown as DashboardDatabase;
  const secrets = {} as SecretStore as TransactionalSecretStore;
  const fullRefreshState = {} as AssetFullRefreshState;

  const lifecycle = new DatabaseAssetSourceLifecycle(
    database,
    secrets,
    fullRefreshState,
  );
  await lifecycle.setEvmTokenPreference(
    "ethereum",
    ["evm:1:native"],
    "ignored",
  );

  assert.equal(updateSourceCalls, 0);
  assert.equal(current.snapshot.total.amount, "125");
  assert.equal(current.snapshot.syncedAt, "2026-09-21T00:00:00.000Z");
  assert.deepEqual(current.ignoredAssetKeys, ["evm:1:native"]);
});

test("断开保留凭证、卡片和历史，直接恢复沿用身份，永久删除才清理凭证", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-lifecycle-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const values = new Map([["secret-reference", "read-only-credentials"]]);
  let cleared = 0;
  const lifecycle = new DatabaseAssetSourceLifecycle(database, {
    get: async (reference) => values.get(reference) ?? null,
    remove: async (reference) => { values.delete(reference); },
  } as SecretStore, {
    clear: async () => { cleared += 1; },
  } as AssetFullRefreshState);
  try {
    const original = source();
    const at = original.snapshot.syncedAt;
    await database.connectLongbridge({
      credentials: "read-only-credentials",
      account: { id: "longbridge-fixture", label: "长桥账户" },
      permissions: ["account", "positions"],
      snapshot: {
        ...original.snapshot,
        exchangeRates: [
          { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "fixture", observedAt: at },
          { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "fixture", observedAt: at },
        ],
      },
    }, "secret-reference", at);
    const connected = (await database.listSources())[0];
    const cards = await database.listAssetCards();
    const baselines = await database.listDailyAssetSnapshots();
    const trends = await database.listDailyAssetTrendObservations();
    assert.equal(baselines.length, 1);
    assert.equal(trends.length, 1);

    await lifecycle.disconnect(connected.id);
    assert.equal(values.get("secret-reference"), "read-only-credentials");
    assert.equal(cleared, 1);
    assert.deepEqual((await database.listSources())[0], { ...connected, lifecycle: "disconnected" });
    assert.deepEqual(await database.listAssetCards(), cards);
    assert.deepEqual(await database.listDailyAssetSnapshots(), baselines);
    assert.deepEqual(await database.listDailyAssetTrendObservations(), trends);

    values.delete("secret-reference");
    await assert.rejects(lifecycle.restore(connected.id), /原连接凭证已不存在/);
    assert.equal((await database.listSources())[0].lifecycle, "disconnected");
    values.set("secret-reference", "read-only-credentials");
    await lifecycle.restore(connected.id);
    assert.deepEqual((await database.listSources())[0], { ...connected, lifecycle: "connected" });
    assert.deepEqual(await database.listAssetCards(), cards);
    assert.deepEqual(await database.listDailyAssetSnapshots(), baselines);
    assert.deepEqual(await database.listDailyAssetTrendObservations(), trends);

    await lifecycle.deleteData(connected.id);
    assert.equal(values.size, 0);
    assert.deepEqual(await database.listSources(), []);
    assert.deepEqual(await database.listAssetCards(), []);
    assert.deepEqual(await database.listDailyAssetSnapshots(), []);
    assert.deepEqual(await database.listDailyAssetTrendObservations(), []);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
