import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketBenchmarkComparison,
  DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  MARKET_BENCHMARKS,
} from "@/domain/market-benchmark";

test("市场基准统一定义标的、名称与默认启用项", () => {
  assert.deepEqual(MARKET_BENCHMARKS, [
    { label: "标普 500", symbol: ".SPX.US" },
    { label: "纳斯达克 100", symbol: ".NDX.US" },
  ]);
  assert.deepEqual(DEFAULT_MARKET_BENCHMARK_SYMBOLS, [".SPX.US", ".NDX.US"]);
});

test("价格指数对比以所选资产范围的变化和首个共同点归一", () => {
  const comparison = buildMarketBenchmarkComparison({
    enabledSymbols: [".SPX.US", ".NDX.US"],
    candles: {
      ".SPX.US": [
        { time: "2026-03-01T00:00:00.000Z", close: "100" },
        { time: "2026-03-02T00:00:00.000Z", close: "110" },
        { time: "2026-03-03T00:00:00.000Z", close: "121" },
      ],
      ".NDX.US": [
        { time: "2026-03-01T00:00:00.000Z", close: "200" },
        { time: "2026-03-02T00:00:00.000Z", close: "210" },
        { time: "2026-03-03T00:00:00.000Z", close: "220.5" },
      ],
    },
    points: [
      { amount: "100", day: "2026-03-01", observedAt: "2026-03-01T04:00:00.000Z", observed: true, status: "complete" },
      { amount: "132", day: "2026-03-02", observedAt: "2026-03-02T04:00:00.000Z", observed: true, status: "complete" },
      { amount: "145.2", day: "2026-03-03", observedAt: "2026-03-03T04:00:00.000Z", observed: true, status: "complete" },
    ],
  });

  assert.equal(comparison.baselineDay, "2026-03-01");
  assert.deepEqual(comparison.points.map((point) => ({
    assets: point.assets,
    day: point.day,
    spx: point[".SPX.US"],
    ndx: point[".NDX.US"],
  })), [
    { assets: "0", day: "2026-03-01", spx: "0", ndx: "0" },
    { assets: "0.32", day: "2026-03-02", spx: "0.1", ndx: "0.05" },
    { assets: "0.452", day: "2026-03-03", spx: "0.21", ndx: "0.1025" },
  ]);
});

test("价格指数只可采用不晚于资产观测时刻的日K，休市沿用旧收盘", () => {
  const comparison = buildMarketBenchmarkComparison({
    enabledSymbols: [".SPX.US"],
    candles: {
      ".SPX.US": [
        { time: "2026-02-28T21:00:00.000Z", close: "100" },
        { time: "2026-03-01T21:00:00.000Z", close: "110" },
      ],
      ".NDX.US": [],
    },
    points: [
      { amount: "100", day: "2026-03-01", observedAt: "2026-03-01T04:00:00.000Z", observed: true, status: "complete" },
      { amount: "110", day: "2026-03-02", observedAt: "2026-03-02T04:00:00.000Z", observed: true, status: "complete" },
    ],
  });

  assert.deepEqual(comparison.points.map((point) => point[".SPX.US"]), ["0", "0.1"]);
});

test("少于两条完整资产观测时不伪造对比曲线", () => {
  const comparison = buildMarketBenchmarkComparison({
    enabledSymbols: [".SPX.US"],
    candles: {
      ".SPX.US": [
        { time: "2026-03-01T00:00:00.000Z", close: "100" },
        { time: "2026-03-02T00:00:00.000Z", close: "110" },
      ],
      ".NDX.US": [],
    },
    points: [
      { amount: "100", day: "2026-03-01", observedAt: "2026-03-01T04:00:00.000Z", observed: true, status: "complete" },
    ],
  });

  assert.equal(comparison.baselineDay, null);
  assert.equal(comparison.reason, "完整资产观测或指数行情不足。");
});
