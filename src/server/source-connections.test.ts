import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseAssetSourceLifecycle } from "@/server/source-connections";
import type { DashboardDatabase } from "@/server/persistence/contracts";
import type { AssetFullRefreshState, AssetSourceSummary, SecretStore } from "@/server/ports";
import type { TransactionalSecretStore } from "@/server/credentials/secret-store";

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
