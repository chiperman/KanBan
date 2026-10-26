"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildMarketBenchmarkComparison,
  MARKET_BENCHMARKS,
  type MarketBenchmarkAssetPoint,
  type MarketBenchmarkCandlestick,
  type MarketBenchmarkComparison,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import { lockOnUnauthorizedResponse } from "@/ui/owner-request-lock";
import { buildInvestmentBookBenchmarkComparison } from "@/domain/investment-book-benchmark";
import type { BookPoint, BookRecord } from "@/domain/investment-books";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { AssetSourceSummary } from "@/server/ports";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";

export type MarketBenchmarkCandles = Record<
  MarketBenchmarkSymbol,
  MarketBenchmarkCandlestick[]
>;

type MarketBenchmarkCandlesState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { candles: MarketBenchmarkCandles; kind: "ready" };

export type MarketBenchmarkDataState =
  | Exclude<MarketBenchmarkCandlesState, { kind: "ready" }>
  | { comparison: MarketBenchmarkComparison; kind: "ready" };

type BenchmarkSource = Pick<AssetSourceSummary, "id" | "kind" | "accountId" | "lifecycle">;
type CandlesCache = {
  key: string;
  state?: Extract<MarketBenchmarkCandlesState, { kind: "ready" }>;
  request?: Promise<MarketBenchmarkCandlesState>;
};
let candlesCache: CandlesCache | null = null;
const candlesRetryListeners = new Set<() => void>();

function cacheKey(scope: string): string {
  return `${shanghaiDay(new Date())}:${scope}`;
}

function isMarketBenchmarkCandles(value: unknown): value is MarketBenchmarkCandles {
  if (typeof value !== "object" || value === null) return false;
  const candles = value as Record<string, unknown>;
  return MARKET_BENCHMARKS.every(({ symbol }) =>
    Array.isArray(candles[symbol]) && candles[symbol].every((candle) =>
      typeof candle === "object" &&
      candle !== null &&
      typeof (candle as Record<string, unknown>).close === "string" &&
      typeof (candle as Record<string, unknown>).time === "string",
    ),
  );
}

function readCandles(cache: CandlesCache): Promise<MarketBenchmarkCandlesState> {
  if (cache.state) return Promise.resolve(cache.state);
  if (cache.request) return cache.request;
  // 请求不随图表隐藏而中断，让再次勾选指数及其他消费者复用同一次读取。
  const request = (async (): Promise<MarketBenchmarkCandlesState> => {
    try {
      const response = await fetch("/api/market-benchmarks/candles", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (lockOnUnauthorizedResponse(response)) return { kind: "failed" };
      if (response.status === 409) return { kind: "unavailable" };
      if (!response.ok) return { kind: "failed" };
      const body = await response.json().catch(() => null) as { candles?: unknown } | null;
      if (!isMarketBenchmarkCandles(body?.candles)) return { kind: "failed" };
      const state = { candles: body.candles, kind: "ready" } as const;
      if (MARKET_BENCHMARKS.every(({ symbol }) => state.candles[symbol].length > 0)) {
        cache.state = state;
      }
      return state;
    } catch {
      return { kind: "failed" };
    }
  })();
  cache.request = request;
  void request.finally(() => {
    if (cache.request === request) cache.request = undefined;
  });
  return request;
}

/** 丢弃失败或挂起的指数读取，并让在监听的图表立即重新拉取。 */
export function retryMarketBenchmarkCandles() {
  if (candlesCache?.state) return;
  if (candlesCache) candlesCache.request = undefined;
  for (const listener of candlesRetryListeners) listener();
}

function useMarketBenchmarkCandles(visible: boolean, sources: readonly BenchmarkSource[]): MarketBenchmarkCandlesState {
  const scope = JSON.stringify(sources.filter(source => source.kind === "longbridge")
    .map(source => [source.id, source.accountId, source.lifecycle ?? "connected"])
    .sort(([left], [right]) => left.localeCompare(right)));
  const [state, setState] = useState<{ scope: string; value: MarketBenchmarkCandlesState }>(() => ({
    scope,
    value: candlesCache?.key === cacheKey(scope) && candlesCache.state
      ? candlesCache.state : { kind: "loading" },
  }));

  useEffect(() => {
    let active = true;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      if (!active || !visible || document.visibilityState === "hidden") return;
      const key = cacheKey(scope);
      if (candlesCache?.key !== key) candlesCache = { key };
      const requestRevision = ++revision;
      void readCandles(candlesCache).then(value => {
        if (active && requestRevision === revision) setState({ scope, value });
      });
      clearTimeout(timer);
      const nextDay = Date.parse(`${shanghaiDay(new Date())}T00:00:00+08:00`) + 86_400_000;
      timer = setTimeout(refresh, Math.max(1, nextDay - Date.now()));
    }
    function lock() {
      active = false;
      candlesCache = null;
      clearTimeout(timer);
      setState({ scope, value: { kind: "loading" } });
    }
    candlesRetryListeners.add(refresh);
    refresh();
    window.addEventListener(OWNER_LOCK_EVENT, lock);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      clearTimeout(timer);
      candlesRetryListeners.delete(refresh);
      window.removeEventListener(OWNER_LOCK_EVENT, lock);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [visible, scope]);

  if (state.scope !== scope) {
    return { kind: "loading" };
  }
  return state.value;
}

/** 读取固定市场指数，并按调用方给出的当前资产区间生成同起点对比。 */
export function useMarketBenchmarkComparison(input: {
  enabledSymbols: MarketBenchmarkSymbol[];
  points: MarketBenchmarkAssetPoint[];
  sources: readonly BenchmarkSource[];
  visible: boolean;
}): MarketBenchmarkDataState {
  const candlesState = useMarketBenchmarkCandles(input.visible, input.sources);

  return useMemo(() => {
    if (candlesState.kind !== "ready") return candlesState;
    return {
      comparison: buildMarketBenchmarkComparison({
        candles: candlesState.candles,
        enabledSymbols: input.enabledSymbols,
        points: input.points,
      }),
      kind: "ready",
    };
  }, [candlesState, input.enabledSymbols, input.points]);
}

export function useInvestmentBookBenchmarkComparison(input: {
  enabledSymbols: MarketBenchmarkSymbol[];
  points: BookPoint[];
  records: BookRecord[];
  sources: readonly BenchmarkSource[];
  visible: boolean;
}): MarketBenchmarkDataState {
  const candlesState = useMarketBenchmarkCandles(input.visible, input.sources);
  return useMemo(() => {
    if (candlesState.kind !== "ready") return candlesState;
    return {
      kind: "ready",
      comparison: buildInvestmentBookBenchmarkComparison({
        candles: candlesState.candles,
        enabledSymbols: input.enabledSymbols,
        points: input.points,
        records: input.records,
      }),
    };
  }, [candlesState, input.enabledSymbols, input.points, input.records]);
}
