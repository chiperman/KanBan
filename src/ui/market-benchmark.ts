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

function useMarketBenchmarkCandles(visible: boolean): MarketBenchmarkCandlesState {
  const [state, setState] = useState<MarketBenchmarkCandlesState>({ kind: "loading" });

  useEffect(() => {
    if (!visible) {
      setState({ kind: "loading" });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({ kind: "loading" });

    void (async () => {
      try {
        const response = await fetch("/api/market-benchmarks/candles", {
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 409) {
          setState({ kind: "unavailable" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "failed" });
          return;
        }
        const body = await response.json().catch(() => null) as {
          candles?: unknown;
        } | null;
        if (!active) return;
        if (!isMarketBenchmarkCandles(body?.candles)) {
          setState({ kind: "failed" });
          return;
        }
        setState({ candles: body.candles, kind: "ready" });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setState({ kind: "failed" });
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [visible]);

  return state;
}

/** 读取固定市场指数，并按调用方给出的当前资产区间生成同起点对比。 */
export function useMarketBenchmarkComparison(input: {
  enabledSymbols: MarketBenchmarkSymbol[];
  points: MarketBenchmarkAssetPoint[];
  visible: boolean;
}): MarketBenchmarkDataState {
  const candlesState = useMarketBenchmarkCandles(input.visible);

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
