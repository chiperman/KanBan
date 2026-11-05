import {
  decimalCompare,
  decimalDivide,
  decimalSubtract,
} from "@/domain/decimal";

export const MARKET_BENCHMARKS = [
  { label: "标普 500", symbol: ".SPX.US" },
  { label: "纳斯达克 100", symbol: ".NDX.US" },
] as const;

export type MarketBenchmarkSymbol =
  (typeof MARKET_BENCHMARKS)[number]["symbol"];

export const DEFAULT_MARKET_BENCHMARK_SYMBOLS: readonly MarketBenchmarkSymbol[] =
  MARKET_BENCHMARKS.map((benchmark) => benchmark.symbol);

export interface MarketBenchmarkCandlestick {
  close: string;
  time: string;
}

export interface MarketBenchmarkAssetPoint {
  amount: string | null;
  day: string;
  observed: boolean;
  observedAt: string | null;
  status: "complete" | "expired" | "incomplete";
}

export interface MarketBenchmarkComparison {
  baselineDay: string | null;
  points: Array<{
    ".NDX.US": string | null;
    ".SPX.US": string | null;
    assets: string | null;
    day: string;
  }>;
  reason: string | null;
}

export function marketBenchmarkLabel(symbol: MarketBenchmarkSymbol): string {
  return MARKET_BENCHMARKS.find((benchmark) => benchmark.symbol === symbol)!.label;
}

function validTime(value: string | null): value is string {
  return value !== null && !Number.isNaN(new Date(value).valueOf());
}

function validPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && decimalCompare(value, "0") > 0;
}

function completeAssetPoint(
  point: MarketBenchmarkAssetPoint,
): point is MarketBenchmarkAssetPoint & { amount: string; observedAt: string } {
  return point.observed &&
    point.status === "complete" &&
    point.amount !== null &&
    validPositiveDecimal(point.amount) &&
    validTime(point.observedAt);
}

/** 每组行情只校验、排序一次；调用方决定收盘价何时可以用于比较。 */
export function createMarketBenchmarkPriceLookup(
  candles: readonly MarketBenchmarkCandlestick[],
  availableAt: (time: number) => number = (time) => time,
): (cutoff: number) => string | null {
  const prices = candles.flatMap((candle) => {
    const time = Date.parse(candle.time);
    if (!Number.isFinite(time) || !validPositiveDecimal(candle.close)) return [];
    const availableTime = availableAt(time);
    return Number.isFinite(availableTime)
      ? [{ close: candle.close, availableAt: availableTime }]
      : [];
  }).toSorted((left, right) => left.availableAt - right.availableAt);

  return (cutoff) => {
    let start = 0;
    let end = prices.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (prices[middle]!.availableAt <= cutoff) start = middle + 1;
      else end = middle;
    }
    return prices[start - 1]?.close ?? null;
  };
}

/**
 * 将所选资产范围的实际资产变化与长桥价格指数在首个共同可比点归一。
 * 资产曲线包含该范围内的资金进出，不将它伪装成资金校正后的投资收益；
 * 指数仅取观测时刻及以前的最新日 K，绝不借用未来价格。
 */
export function buildMarketBenchmarkComparison(input: {
  candles: Record<MarketBenchmarkSymbol, MarketBenchmarkCandlestick[]>;
  enabledSymbols: MarketBenchmarkSymbol[];
  points: MarketBenchmarkAssetPoint[];
}): MarketBenchmarkComparison {
  const symbols = [...new Set(input.enabledSymbols)];
  const completePoints = input.points.filter(completeAssetPoint);
  if (completePoints.length < 2 || symbols.length === 0) {
    return { baselineDay: null, points: [], reason: "完整资产观测或指数行情不足。" };
  }
  const prices = new Map(symbols.map((symbol) => [
    symbol,
    createMarketBenchmarkPriceLookup(input.candles[symbol]),
  ]));
  const closeAt = (symbol: MarketBenchmarkSymbol, observedAt: string) =>
    prices.get(symbol)!(Date.parse(observedAt));

  const firstComparableIndex = completePoints.findIndex((point) =>
    symbols.every((symbol) =>
      closeAt(symbol, point.observedAt) !== null
    )
  );
  if (firstComparableIndex < 0) {
    return { baselineDay: null, points: [], reason: "指数行情不足，无法找到共同可比起点。" };
  }

  const baseline = completePoints[firstComparableIndex]!;
  const baselineCloses = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    closeAt(symbol, baseline.observedAt),
  ])) as Record<MarketBenchmarkSymbol, string | null>;
  const results: MarketBenchmarkComparison["points"] = [{
    assets: "0",
    day: baseline.day,
    ".SPX.US": symbols.includes(".SPX.US") ? "0" : null,
    ".NDX.US": symbols.includes(".NDX.US") ? "0" : null,
  }];

  for (const point of completePoints.slice(firstComparableIndex + 1)) {
    const comparisonPoint: MarketBenchmarkComparison["points"][number] = {
      assets: decimalSubtract(decimalDivide(point.amount, baseline.amount), "1"),
      day: point.day,
      ".SPX.US": null,
      ".NDX.US": null,
    };
    for (const symbol of symbols) {
      const close = closeAt(symbol, point.observedAt);
      const baselineClose = baselineCloses[symbol];
      comparisonPoint[symbol] = close === null || baselineClose === null
        ? null
        : decimalSubtract(decimalDivide(close, baselineClose), "1");
    }
    results.push(comparisonPoint);
  }

  return { baselineDay: baseline.day, points: results, reason: null };
}
