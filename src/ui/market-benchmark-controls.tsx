"use client";

import type { ReactNode } from "react";

import {
  MARKET_BENCHMARKS,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import type { MarketBenchmarkDataState } from "@/ui/market-benchmark";
import { VibeButton } from "@/ui/vibe/vibe-button";

function assetLabel(assetScopeLabel: string): string {
  return assetScopeLabel.endsWith("资产")
    ? assetScopeLabel
    : `${assetScopeLabel}资产`;
}

function BenchmarkState({
  children,
  title,
}: {
  children?: string;
  title: string;
}) {
  return (
    <div className="investment-performance__benchmark-state" role="status">
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

export function MarketBenchmarkControls({
  assetScopeLabel,
  dataState,
  enabledSymbols,
  formatDay,
  onEnabledSymbolsChange,
}: {
  assetScopeLabel: string;
  dataState: MarketBenchmarkDataState;
  enabledSymbols: MarketBenchmarkSymbol[];
  formatDay(day: string): string;
  onEnabledSymbolsChange(symbols: MarketBenchmarkSymbol[]): void;
}) {
  const assetsLabel = assetLabel(assetScopeLabel);

  function toggle(symbol: MarketBenchmarkSymbol) {
    onEnabledSymbolsChange(
      enabledSymbols.includes(symbol)
        ? enabledSymbols.filter((item) => item !== symbol)
        : [...enabledSymbols, symbol],
    );
  }

  let state: ReactNode = null;
  if (dataState.kind === "unavailable") {
    // 只说「未连接」会让人以为功能坏了；补一句成因与下一步，避免误判为故障。
    state = (
      <BenchmarkState title="未连接长桥">
        未接入长桥行情，指数对比不可用；接入后自动出现。
      </BenchmarkState>
    );
  } else if (dataState.kind === "failed") {
    state = (
      <BenchmarkState title="指数读取失败" />
    );
  } else if (dataState.kind === "ready" && enabledSymbols.length === 0) {
    state = (
      <BenchmarkState title="未选指数" />
    );
  } else if (dataState.kind === "ready" && dataState.comparison.reason !== null) {
    state = (
      <BenchmarkState title="数据不足">
        {dataState.comparison.reason}
      </BenchmarkState>
    );
  }

  return (
    <div className="investment-performance__benchmark" data-testid="performance-benchmark">
      <div className="investment-performance__benchmark-heading">
        <div>
          <strong>市场对比</strong>
        </div>
        <span
          aria-atomic="true"
          className="investment-performance__benchmark-baseline"
          role="status"
        >
          {dataState.kind === "loading"
            ? "行情加载中"
            : dataState.kind === "ready" && dataState.comparison.baselineDay !== null
              ? `基准起点 ${formatDay(dataState.comparison.baselineDay)}`
              : "\u00a0"}
        </span>
      </div>
      <div
        aria-label="市场指数"
        className="investment-performance__benchmark-controls"
        role="group"
      >
        {MARKET_BENCHMARKS.map((benchmark) => {
          const selected = enabledSymbols.includes(benchmark.symbol);
          return (
            <VibeButton
              aria-pressed={selected}
              className="investment-performance__benchmark-toggle"
              key={benchmark.symbol}
              onClick={() => toggle(benchmark.symbol)}
              type="button"
              variant={selected ? "primary" : "outline"}
            >
              {benchmark.label}
            </VibeButton>
          );
        })}
      </div>
      {state}
    </div>
  );
}
