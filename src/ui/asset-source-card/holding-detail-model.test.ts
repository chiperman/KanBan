import assert from "node:assert/strict";
import test from "node:test";
import type { AssetHolding } from "@/server/ports";
import {
  amount,
  holdingProfit,
  holdingQuoteSessionText,
  holdingTodayProfit,
  holdingValuationDetail,
} from "./holding-detail-model";

const holding: AssetHolding = {
  symbol: "AAPL.US", name: "Apple", quantity: "10", currency: "USD",
  assetClass: "securities", currentPrice: { amount: "12", currency: "USD" },
  previousClose: { amount: "10", currency: "USD" }, costPrice: "8",
  marketValue: "120", sourceMarketValue: { amount: "120", currency: "USD" },
  platformProfit: null, changePercent: null,
  valuation: { status: "valued", priceSource: "Longbridge 行情", pricedAt: "2026-10-01T01:00:00.000Z" },
};

test("持仓与当日盈亏保持精确十进制计算及空头口径", () => {
  assert.deepEqual(holdingProfit(holding), { amount: "40", percent: "50.00" });
  assert.deepEqual(holdingTodayProfit(holding), { amount: "20", percent: "20.00" });
  assert.deepEqual(holdingProfit({ ...holding, quantity: "-10" }), { amount: "-40", percent: "-50.00" });
  assert.deepEqual(holdingTodayProfit({ ...holding, quantity: "-10" }), { amount: "-20", percent: "20.00" });
  assert.equal(holdingProfit({ ...holding, quantity: "9007199254740993" })?.amount, "36028797018963972");
  assert.equal(amount("9007199254740993.12345678"), "9,007,199,254,740,993.12345678");
});

test("成本、昨收缺失或币种不一致不伪造盈亏", () => {
  for (const change of [
    { currentPrice: null }, { currentPrice: { amount: "12", currency: "HKD" } },
    { costPrice: null }, { costPrice: "0" }, { quantity: "0" },
  ]) assert.equal(holdingProfit({ ...holding, ...change }), null);
  for (const change of [
    { currentPrice: null }, { currentPrice: { amount: "12", currency: "HKD" } },
    { previousClose: null }, { previousClose: undefined },
    { previousClose: { amount: "0", currency: "USD" } },
    { previousClose: { amount: "10", currency: "HKD" } },
  ]) assert.equal(holdingTodayProfit({ ...holding, ...change }), null);
});

test("证券旧快照不将同步时间冒充行情时间，隐私模式隐藏行情时段", () => {
  assert.equal(holdingQuoteSessionText(holding, true), "时段未知 · 时间不可用");
  assert.equal(holdingValuationDetail(holding), "Longbridge 行情 · 时间不可用");
  const retained: AssetHolding = {
    ...holding,
    quoteEvidence: {
      session: "post-market", quotedAt: "2026-10-01T00:00:00.000Z",
      observedAt: "2026-10-01T01:00:00.000Z", freshness: "retained", delivery: "delayed",
      provider: { name: "Longbridge", tradeStatus: null },
    },
  };
  assert.equal(holdingQuoteSessionText(retained, true), "保留行情 · 延迟行情 · 盘后 · 行情 2026-10-01 08:00");
  assert.equal(holdingValuationDetail(retained), "Longbridge 行情 · 2026-10-01 08:00");
  assert.equal(holdingQuoteSessionText(retained, false), null);
  assert.equal(holdingQuoteSessionText({ ...retained, currentPrice: null }, true), null);
  assert.equal(holdingValuationDetail({ ...holding, valuation: { status: "unvalued", reason: "缺少报价" } }), "缺少报价");
});

test("加密资产保留 24h 报价时间，非行情证券快照不附加会话", () => {
  const crypto: AssetHolding = {
    ...holding, assetClass: "crypto",
    valuation: { status: "valued", priceSource: "fixture", pricedAt: "2026-10-01T01:00:00.000Z" },
  };
  assert.equal(holdingQuoteSessionText(crypto, true), "24h · 行情 2026-10-01 09:00");
  assert.equal(holdingQuoteSessionText({ ...crypto, assetClass: "securities" }, true), null);
  assert.equal(holdingQuoteSessionText({ ...crypto, quoteEvidence: {
    session: "regular", quotedAt: null, observedAt: "2026-10-01T01:00:00.000Z",
    freshness: "unavailable", delivery: "unknown", provider: { name: "fixture", tradeStatus: null },
  } }, true), "24h · 行情 2026-10-01 09:00");
});
