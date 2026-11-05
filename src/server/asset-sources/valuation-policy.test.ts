import assert from "node:assert/strict";
import test from "node:test";
import type { AssetHolding, PriceQuote } from "@/server/ports";
import { compareSourceHoldingValue, effectiveUsdtUsdQuote } from "./valuation-policy";

test("USDT/USD 报价保留五分钟边界与引用身份，不把固定兜底当行情", () => {
  const observedAt = "2026-10-12T01:00:00.000Z";
  const quote: PriceQuote = { symbol: "USDT", currency: "USD", price: "0.999", quotedAt: new Date(observedAt) };
  for (const offset of [-300_000, 0, 300_000]) {
    const candidate = { ...quote, quotedAt: new Date(Date.parse(observedAt) + offset) };
    assert.equal(effectiveUsdtUsdQuote(candidate, observedAt), candidate);
  }
  for (const candidate of [
    null,
    { ...quote, symbol: "USDC" },
    { ...quote, currency: "USDT" },
    { ...quote, price: "0" },
    { ...quote, price: "-1" },
    { ...quote, price: "1e2" },
    { ...quote, quotedAt: new Date("invalid") },
    { ...quote, quotedAt: new Date(Date.parse(observedAt) - 300_001) },
    { ...quote, quotedAt: new Date(Date.parse(observedAt) + 300_001) },
  ]) {
    const fallback = effectiveUsdtUsdQuote(candidate, observedAt);
    assert.notEqual(fallback, candidate);
    assert.deepEqual(fallback, { ...quote, price: "1" });
  }
});

test("来源持仓按精确十进制市值降序，等值和未估值保持原顺序", () => {
  const holding = (id: string, value: string | null) => ({
    symbol: id,
    sourceMarketValue: value === null ? null : { amount: value, currency: "USDT" },
  }) as AssetHolding;
  const values = [holding("missing-a", null), holding("small", "9007199254740992.1"),
    holding("equal-a", "9007199254740993.1"), holding("equal-b", "9007199254740993.10"), holding("missing-b", null)];
  assert.deepEqual(values.toSorted(compareSourceHoldingValue).map(item => item.symbol),
    ["equal-a", "equal-b", "small", "missing-a", "missing-b"]);
});
