import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveEvmSnapshotCoverage,
  normalizeIgnoredAssetKeys,
  portfolioSourceTotal,
  updateEvmTokenPreferences,
} from "@/domain/evm-token-preferences";
import { buildTotalValuation } from "@/domain/valuation";
import type { AssetSourceSummary } from "@/server/ports";

function source(): AssetSourceSummary {
  return {
    id: "ethereum",
    kind: "evm-watch-ethereum",
    label: "Ethereum 观察钱包",
    accountId: "ethereum:test",
    permissions: ["public-address"],
    credentialReference: "server-only",
    sync: {
      status: "current",
      lastSuccessfulAt: "2026-08-25T00:00:00.000Z",
      lastAttemptAt: "2026-08-25T00:00:00.000Z",
      error: null,
    },
    snapshot: {
      total: { amount: "5519", currency: "USD" },
      holdings: [{
        symbol: "ETH",
        name: "Ethereum",
        sourceAsset: "evm:1:native",
        quantity: "2.5",
        currency: "USD",
        assetClass: "crypto",
        currentPrice: { amount: "2000", currency: "USD" },
        marketValue: "5000",
        sourceMarketValue: { amount: "5000", currency: "USD" },
        valuation: {
          status: "valued",
          priceSource: "CoinGecko",
          pricedAt: "2026-08-25T00:00:00.000Z",
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }, {
        symbol: "YRISE",
        name: "YRISE · Ethereum ERC-20",
        sourceAsset: "evm:1:0x6051c1354ccc51b4d561e43b02735deae64768b8",
        quantity: "0.00009",
        currency: "USD",
        assetClass: "crypto",
        currentPrice: { amount: "164036866.518111", currency: "USD" },
        marketValue: "14763.31798662999",
        sourceMarketValue: { amount: "14763.31798662999", currency: "USD" },
        valuation: {
          status: "valued",
          priceSource: "CoinGecko",
          pricedAt: "2026-08-25T00:00:00.000Z",
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [],
      syncedAt: "2026-08-25T00:00:00.000Z",
    },
  };
}

test("EVM 观察钱包可忽略已估值 ERC-20 和原生币，并从总额排除", () => {
  const initial = source();
  const token = "evm:1:0x6051c1354ccc51b4d561e43b02735deae64768b8";
  const tokenIgnored = updateEvmTokenPreferences(initial, [token], "ignored");
  assert.deepEqual(tokenIgnored.ignoredAssetKeys, [token]);

  const nativeIgnored = updateEvmTokenPreferences(
    { ...initial, ignoredAssetKeys: tokenIgnored.ignoredAssetKeys },
    ["evm:1:native"],
    "ignored",
  );
  assert.deepEqual(nativeIgnored.ignoredAssetKeys, [
    token,
    "evm:1:native",
  ].sort());
  assert.deepEqual(
    portfolioSourceTotal({
      ...initial,
      ignoredAssetKeys: nativeIgnored.ignoredAssetKeys,
    }),
    { amount: "0", currency: "USD" },
  );
});

test("忽略列表不接受协议仓位标识", () => {
  assert.deepEqual(normalizeIgnoredAssetKeys([
    "evm:1:native",
    "evm:1:lido-withdrawal:18",
  ]), ["evm:1:native"]);
});

test("未确认的未估值 EVM 代币不阻断组合估值，明确纳入后才阻断", () => {
  const unconfirmed = source();
  const token = "evm:1:0x6051c1354ccc51b4d561e43b02735deae64768b8";
  const holding = unconfirmed.snapshot.holdings[1]!;
  holding.currentPrice = null;
  holding.marketValue = null;
  holding.sourceMarketValue = null;
  holding.valuation = { status: "unvalued", reason: "来源没有可靠价格" };
  unconfirmed.snapshot.total = { amount: "5000", currency: "USD" };
  unconfirmed.snapshot.coverage = {
    status: "partial",
    products: [],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };

  const unconfirmedValuation = buildTotalValuation(
    [unconfirmed],
    "USD",
    "source",
  );
  assert.equal(unconfirmedValuation.incomplete, false);
  assert.equal(unconfirmedValuation.unvaluedCount, 0);

  const includedValuation = buildTotalValuation(
    [{ ...unconfirmed, includedAssetKeys: [token] }],
    "USD",
    "source",
  );
  assert.equal(includedValuation.incomplete, true);
  assert.equal(includedValuation.unvaluedCount, 1);
});

test("忽略当前未估值代币后，来源覆盖恢复为完整", () => {
  const token = "evm:56:0x6051c1354ccc51b4d561e43b02735deae64768b8";
  const current = source();
  current.kind = "evm-watch-bsc";
  current.snapshot.coverage = {
    status: "partial",
    products: [{
      product: "lista-slisbnb-withdrawal-request",
      capability: "detailed",
      freshness: "current",
      message: "未发现未领取申请",
    }],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };
  current.snapshot.holdings[1]!.sourceAsset = token;
  current.snapshot.holdings[1]!.valuation = {
    status: "unvalued",
    reason: "CoinGecko 未返回可靠 USD 参考价格",
  };
  current.ignoredAssetKeys = [token];

  const coverage = effectiveEvmSnapshotCoverage(current);
  assert.equal(coverage?.status, "complete");
  assert.deepEqual(coverage?.products, []);
});

test("明确纳入未估值代币后，来源覆盖重新标记为不完整", () => {
  const token = "evm:56:0x6051c1354ccc51b4d561e43b02735deae64768b8";
  const current = source();
  current.kind = "evm-watch-bsc";
  current.snapshot.coverage = {
    status: "complete",
    products: [],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };
  current.snapshot.holdings[1]!.sourceAsset = token;
  current.snapshot.holdings[1]!.valuation = {
    status: "unvalued",
    reason: "CoinGecko 未返回可靠 USD 参考价格",
  };
  current.includedAssetKeys = [token];

  assert.equal(effectiveEvmSnapshotCoverage(current)?.status, "partial");
});
