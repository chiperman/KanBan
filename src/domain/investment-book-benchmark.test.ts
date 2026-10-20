import assert from "node:assert/strict";
import test from "node:test";
import { buildInvestmentBookBenchmarkComparison } from "@/domain/investment-book-benchmark";
import type { BookPoint, BookRecord } from "@/domain/investment-books";
import type { MarketBenchmarkSymbol } from "@/domain/market-benchmark";

const candles = {
  ".SPX.US": [
    { time: "2026-02-28T14:30:00Z", close: "100" },
    { time: "2026-03-01T14:30:00Z", close: "110" },
    { time: "2026-03-02T14:30:00Z", close: "120" },
    { time: "2026-03-04T14:30:00Z", close: "130" },
  ],
  ".NDX.US": [
    { time: "2026-02-28T14:30:00Z", close: "200" },
    { time: "2026-03-01T14:30:00Z", close: "190" },
    { time: "2026-03-02T14:30:00Z", close: "220" },
  ],
};
function point(day: string, total: string | null, netInvestment: string | null = "100"): BookPoint {
  return { day: `2026-03-${day}`, total, netInvestment, profit: null, returnRatio: null, basis: "测试" };
}
function flow(day: string, kind: BookRecord["kind"], amount: string, extra: Partial<BookRecord> = {}): BookRecord {
  return { id: `${day}-${kind}`, day: `2026-03-${day}`, kind, amount, bookId: "us-stocks", currency: "USD", note: "", recordedAt: "2026-03-10T00:00:00Z", origin: "manual", originKey: `${day}-${kind}`, ...extra };
}
function compare(points: BookPoint[], records: BookRecord[] = [], enabledSymbols: MarketBenchmarkSymbol[] = [".SPX.US", ".NDX.US"]) {
  return buildInvestmentBookBenchmarkComparison({ points, records, candles, enabledSymbols });
}

test("纯入金出金不产生收益，起点同日及之前的资金不重复扣除", () => {
  const result = compare([point("02", "100"), point("03", "200"), point("04", "150")], [
    flow("01", "opening", "50"), flow("02", "deposit", "50"),
    flow("03", "deposit", "100"), flow("04", "withdrawal", "50"),
  ]);
  assert.equal(result.baselineDay, "2026-03-02");
  assert.deepEqual(result.points.map(point => point.assets), ["0", "0", "0"]);
  assert.deepEqual(result.points.map(point => point[".SPX.US"]), ["0", "0.1", "0.2"]);
  assert.deepEqual(result.points.map(point => point[".NDX.US"]), ["0", "-0.05", "0.1"]);
});

test("期中入金按发生日期加权，真实盈利及亏损保留", () => {
  const result = compare([point("02", "100"), point("03", "200"), point("04", "215"), point("06", "180")], [flow("03", "deposit", "100")]);
  assert.equal(result.points[2].assets, "0.1"); // 15 / (100 + 100 * 1/2)
  assert.ok(Math.abs(Number(result.points[3].assets) - -20 / 175) < 1e-12);
});

test("期中出金、作废记录及未来资金不误算为收益", () => {
  const result = compare([point("02", "100"), point("03", "60"), point("04", "68")], [
    flow("03", "withdrawal", "40"), flow("03", "deposit", "500", { voidedAt: "2026-03-10T00:00:00Z" }),
    flow("06", "deposit", "1000"),
  ]);
  assert.deepEqual(result.points.map(point => point.assets), ["0", "0", "0.1"]);
});

test("比较起点随区间重算，不对累计收益率做相减或相除", () => {
  const result = compare([{ ...point("03", "200"), returnRatio: "0.5" }, { ...point("04", "220"), returnRatio: "0.8" }]);
  assert.deepEqual(result.points.map(point => point.assets), ["0", "0.1"]);
});

test("缺少本金或归属不明不以正资产冒充可计算收益，缺估值与无效分母留空", () => {
  assert.ok(compare([point("02", "100", null), point("03", "200", null)]).reason);
  const result = compare([point("02", "100"), point("03", null), point("04", "0"), point("06", "0")], [flow("03", "withdrawal", "200")]);
  assert.deepEqual(result.points.map(point => point.assets), []); // 仅起点可算，拒绝伪造整条曲线。
  const gaps = compare([point("02", "100"), point("03", null), point("04", "100"), point("06", "100", null)]);
  assert.deepEqual(gaps.points.map(point => point.assets), ["0", null, "0", null]);
});

test("零与负收益可比较，资产归零可显示真实 -100%", () => {
  assert.deepEqual(compare([point("02", "100"), point("03", "0")]).points.map(point => point.assets), ["0", "-1"]);
});

test("采用上海日初已收盘指数，不借用开盘时间戳对应的未来收盘，休市沿用", () => {
  const result = compare([point("01", "100"), point("02", "100"), point("03", "100"), point("05", "100")]);
  assert.equal(result.baselineDay, "2026-03-02");
  assert.deepEqual(result.points.map(point => point[".SPX.US"]), ["0", "0.1", "0.2"]);
});

test("指数覆盖不足、少于两点与未选指数均明确不可比较，单选不要求另一指数", () => {
  assert.ok(compare([point("01", "100"), point("02", "100")]).reason);
  assert.ok(compare([point("02", "100")]).reason);
  assert.ok(compare([point("02", "100"), point("03", "100")], [], []).reason);
  const result = buildInvestmentBookBenchmarkComparison({ points: [point("02", "100"), point("03", "110")], records: [], enabledSymbols: [".SPX.US"], candles: { ...candles, ".NDX.US": [] } });
  assert.equal(result.reason, null);
  assert.equal(result.points[1][".NDX.US"], null);
});
