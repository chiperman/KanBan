import { decimalAdd, decimalCompare, decimalDivide, decimalMultiply, decimalSubtract } from "@/domain/decimal";
import type { BookPoint, BookRecord } from "@/domain/investment-books";
import {
  createMarketBenchmarkPriceLookup,
  type MarketBenchmarkCandlestick,
  type MarketBenchmarkComparison,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";

const newYorkDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function settledAt(time: number): number {
  // 日 K 时间可能是开盘时间；保守等到该纽约交易日 21:00 UTC 后才允许使用收盘价。
  return Math.max(time, Date.parse(`${newYorkDay.format(new Date(time))}T21:00:00Z`));
}

/** 独立重算共同起点后的 Modified Dietz，不能对累计资金加权收益率简单相减或相除。 */
export function buildInvestmentBookBenchmarkComparison(input: {
  candles: Record<MarketBenchmarkSymbol, MarketBenchmarkCandlestick[]>;
  enabledSymbols: MarketBenchmarkSymbol[];
  points: BookPoint[];
  records: BookRecord[];
}): MarketBenchmarkComparison {
  const unavailable = (reason: string): MarketBenchmarkComparison => ({ baselineDay: null, points: [], reason });
  const symbols = [...new Set(input.enabledSymbols)];
  if (!symbols.length) return unavailable("请选择市场指数。");
  const prices = new Map(symbols.map(symbol => [
    symbol,
    createMarketBenchmarkPriceLookup(input.candles[symbol], settledAt),
  ]));
  // 账本只有自然日而无观测时刻，统一采用上海当日零点前已收盘价格，不借用盘中或未来日 K。
  const closeAt = (symbol: MarketBenchmarkSymbol, day: string) => {
    const cutoff = Date.parse(`${day}T00:00:00+08:00`);
    return prices.get(symbol)!(cutoff);
  };
  const points = input.points.toSorted((a, b) => a.day.localeCompare(b.day));
  const baseline = points.find(point => point.total !== null && point.netInvestment !== null &&
    decimalCompare(point.total, "0") > 0 && symbols.every(symbol => closeAt(symbol, point.day) !== null));
  if (!baseline) return unavailable("缺少已确认本金与资金归属的资产记录，或指数历史未覆盖所选区间。");
  const baselineCloses = new Map(symbols.map(symbol => [symbol, closeAt(symbol, baseline.day)!]));
  const flows = input.records.filter(record => !record.voidedAt &&
    (record.kind === "deposit" || record.kind === "withdrawal") && record.day > baseline.day);
  const signed = (record: BookRecord) => record.kind === "withdrawal" ? decimalSubtract("0", record.amount) : record.amount;
  const results: MarketBenchmarkComparison["points"] = points.filter(point => point.day >= baseline.day).map(point => {
    const span = Date.parse(point.day) - Date.parse(baseline.day);
    const periodFlows = flows.filter(flow => flow.day <= point.day);
    const denominator = decimalAdd(baseline.total!, ...periodFlows.map(flow =>
      decimalMultiply(signed(flow), decimalDivide(String(Date.parse(point.day) - Date.parse(flow.day)), String(span)))));
    const profit = point.total === null ? null : decimalSubtract(decimalSubtract(point.total, baseline.total!), decimalAdd(...periodFlows.map(signed)));
    const assets = point.netInvestment === null || profit === null ? null : span === 0 ? "0" :
      decimalCompare(denominator, "0") > 0 ? decimalDivide(profit, denominator) : null;
    const result: MarketBenchmarkComparison["points"][number] = { day: point.day, assets, ".SPX.US": null, ".NDX.US": null };
    for (const symbol of symbols) {
      const close = closeAt(symbol, point.day);
      result[symbol] = close === null ? null : decimalSubtract(decimalDivide(close, baselineCloses.get(symbol)!), "1");
    }
    return result;
  });
  if (results.filter(point => point.assets !== null).length < 2) return unavailable("所选区间至少需要两个可计算收益率且有指数覆盖的资产日期。");
  return { baselineDay: baseline.day, points: results, reason: null };
}
