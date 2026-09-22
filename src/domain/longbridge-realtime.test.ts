import assert from "node:assert/strict";
import test from "node:test";

import { applyLongbridgeRealtimeQuote } from "@/domain/longbridge-realtime";
import type { AssetSourceSummary } from "@/server/ports";

function source(): AssetSourceSummary {
  return {
    id: "longbridge",
    kind: "longbridge",
    label: "长桥",
    accountId: "account",
    permissions: ["account", "positions", "market-data"],
    credentialReference: "macos-keychain:longbridge",
    lifecycle: "connected",
    sync: {
      status: "current",
      lastSuccessfulAt: "2026-09-22T01:00:00.000Z",
      lastAttemptAt: "2026-09-22T01:00:00.000Z",
      error: null,
    },
    snapshot: {
      total: { amount: "1000", currency: "USD" },
      exchangeRates: [],
      syncedAt: "2026-09-22T01:00:00.000Z",
      holdings: [{
        symbol: "AAPL.US",
        name: "Apple",
        quantity: "2",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: "400", currency: "USD" },
        previousClose: { amount: "400", currency: "USD" },
        marketValue: "800",
        sourceMarketValue: { amount: "800", currency: "USD" },
        valuation: { status: "valued", priceSource: "Longbridge 行情", pricedAt: "2026-09-22T01:00:00.000Z" },
        costPrice: "300",
        platformProfit: "200",
        changePercent: "0",
      }],
    },
  };
}

test("实时行情只覆盖内存快照并重新计算市值和浮动盈亏", () => {
  const updated = applyLongbridgeRealtimeQuote(source(), {
    symbol: "AAPL.US",
    last_done: "450",
    prev_close: "420",
    timestamp: "1790038800",
  }, "2026-09-22T02:00:00.000Z");
  const holding = updated.snapshot.holdings[0];
  assert.equal(holding.marketValue, "900");
  assert.equal(holding.platformProfit, "300");
  assert.equal(holding.changePercent, "7.1428571428571428");
  assert.equal(updated.snapshot.total.amount, "1100");
  assert.equal(holding.quoteEvidence?.freshness, "current");
});

test("旧行情不会覆盖新行情", () => {
  const current = source();
  current.snapshot.holdings[0].quoteEvidence = {
    session: "regular",
    quotedAt: "2026-09-22T02:00:00.000Z",
    observedAt: "2026-09-22T02:00:00.000Z",
    freshness: "current",
    delivery: "unknown",
    provider: { name: "longbridge", tradeStatus: "NORMAL" },
  };
  const updated = applyLongbridgeRealtimeQuote(current, {
    symbol: "AAPL.US",
    last_done: "1",
    timestamp: "1790035200",
  });
  assert.equal(updated.snapshot.holdings[0].currentPrice?.amount, "400");
});
