import { type ReactNode } from "react";

import {
  type MarketBenchmarkComparison,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";

export type AssetTrendChartPoint = {
  amount: string | null;
  day: string;
  events?: AssetTrendEvent[];
  manualRecordDay?: string;
  observed: boolean;
  status: "complete" | "incomplete" | "expired";
};

export type AssetTrendEvent = {
  amount: string;
  currency: string;
  kind: "opening" | "deposit" | "withdrawal";
  originalAmount?: { amount: string; currency: string };
};

export type ChartDatum = AssetTrendChartPoint & {
  historicalAmount: string | null;
  historicalLabel: string | null;
  historicalValue: number | null;
  value: number | null;
};

export type BenchmarkChartDatum = AssetTrendChartPoint & {
  ".NDX.US": number | null;
  ".SPX.US": number | null;
  assets: number | null;
};

export type AssetTrendBenchmark = {
  assetScopeLabel: string;
  comparison: MarketBenchmarkComparison | null;
  enabledSymbols: MarketBenchmarkSymbol[];
  returnComparison?: boolean;
};

export const TREND_CHART_ANIMATION_DURATION = 200;
// Keep event shapes above the cursor and active dot.
export const FUNDING_EVENT_Z_INDEX = 1300;

export function assetLabel(assetScopeLabel: string): string {
  return assetScopeLabel.endsWith("资产") ? assetScopeLabel : `${assetScopeLabel}资产`;
}

export function percentage(value: number, signed = false): string {
  const normalized = Math.abs(value) < 0.000_000_1 ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${(normalized * 100).toFixed(2)}%`;
}

export type AssetTrendChartProps = {
  ariaLabel: string;
  benchmark?: AssetTrendBenchmark | null;
  chartHeight?: number;
  currency: string;
  dateAxisPresentation?: "default" | "compact";
  formatAmount(value: string): string;
  formatDay(day: string): string;
  isSensitiveHidden?: boolean;
  historicalSeries?: {
    label: string;
    points: AssetTrendChartPoint[];
  } | null;
  emptyMessage?: string;
  points: AssetTrendChartPoint[];
  showCurrency?: boolean;
  showDotFill?: boolean;
  lineType?: "linear" | "monotone" | "stepAfter";
  plotPresentation?: "default" | "minimal";
  variant?: "source" | "total";
};

export type ResolvedChartProps = Required<Omit<AssetTrendChartProps, "benchmark" | "chartHeight">> &
  Pick<AssetTrendChartProps, "chartHeight">;
export type PlotFrameProps = {
  dateAxis: ReactNode;
  benchmarkLegend: ReactNode;
  dotFillId: string;
  glowId: string;
};
