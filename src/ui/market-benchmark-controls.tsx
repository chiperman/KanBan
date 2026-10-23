"use client";

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
  tone,
}: {
  children?: string;
  title: string;
  tone: "error" | "warning" | "muted";
}) {
  return (
    <div className="investment-performance__benchmark-state" data-vibe-tone={tone} role="status">
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
  returnComparison = false,
}: {
  assetScopeLabel: string;
  dataState: MarketBenchmarkDataState;
  enabledSymbols: MarketBenchmarkSymbol[];
  formatDay(day: string): string;
  onEnabledSymbolsChange(symbols: MarketBenchmarkSymbol[]): void;
  returnComparison?: boolean;
}) {
  const assetsLabel = assetLabel(assetScopeLabel);

  function toggle(symbol: MarketBenchmarkSymbol) {
    onEnabledSymbolsChange(
      enabledSymbols.includes(symbol)
        ? enabledSymbols.filter((item) => item !== symbol)
        : [...enabledSymbols, symbol],
    );
  }

  const comparisonReady = enabledSymbols.length > 0 &&
    dataState.kind === "ready" && dataState.comparison.reason === null;
  const stateTitle = returnComparison
    ? comparisonReady ? "区间收益率" : "累计收益率"
    : comparisonReady ? "资产变化率" : "资产金额";
  let stateDescription: string | undefined;
  if (enabledSymbols.length === 0) {
    stateDescription = returnComparison
      ? undefined
      : "未选指数，选择至少一个指数即可查看市场对比。";
  } else if (comparisonReady) {
    stateDescription = returnComparison
      ? undefined
      : `${assetsLabel}与指数从共同起点比较；资产变化包含资金进出。`;
  } else if (dataState.kind === "loading") {
    stateDescription = undefined;
  } else if (dataState.kind === "unavailable") {
    stateDescription = "接入长桥行情后可对比。";
  } else if (dataState.kind === "failed") {
    stateDescription = "指数加载失败，刷新重试。";
  } else {
    stateDescription = dataState.comparison.reason!;
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
          {comparisonReady && dataState.kind === "ready" && dataState.comparison.baselineDay !== null
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
              variant="outline"
            >
              <span
                aria-hidden="true"
                className={`benchmark-color-swatch benchmark-color-swatch--${benchmark.symbol === ".SPX.US" ? "spx" : "ndx"}`}
              />
              {benchmark.label}
            </VibeButton>
          );
        })}
      </div>
      <BenchmarkState title={stateTitle} tone={enabledSymbols.length > 0 && dataState.kind === "failed" ? "error" : enabledSymbols.length > 0 && dataState.kind === "ready" && !comparisonReady ? "warning" : "muted"}>{stateDescription}</BenchmarkState>
    </div>
  );
}
