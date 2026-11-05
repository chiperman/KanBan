"use client";

import { useId } from "react";
import { XAxis } from "recharts";

import { marketBenchmarkLabel } from "@/domain/market-benchmark";

import { renderBenchmarkPlot } from "./asset-trend/benchmark-plot";
import { AssetTrendDateTick, CalendarAssetTrendXAxis } from "./asset-trend/date-axis";
import { assetLabel, type AssetTrendChartProps } from "./asset-trend/shared";
import { renderValuePlot } from "./asset-trend/value-plot";

export {
  AssetTrendDateTick,
  calendarAssetTrendTicks,
  CalendarAssetTrendXAxis,
  CompactAssetTrendDateTick,
} from "./asset-trend/date-axis";
export type { AssetTrendChartPoint, AssetTrendEvent } from "./asset-trend/shared";

export function AssetTrendChart({
  ariaLabel,
  benchmark,
  chartHeight,
  currency,
  dateAxisPresentation = "default",
  formatAmount,
  formatDay,
  isSensitiveHidden = false,
  historicalSeries = null,
  emptyMessage = "无可用趋势",
  points,
  showCurrency = true,
  showDotFill = true,
  lineType = "monotone",
  plotPresentation = "default",
  variant = "total",
}: AssetTrendChartProps) {
  const dotFillId = `asset-trend-dots-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const glowId = `${dotFillId}-glow`;

  const benchmarkVisible =
    benchmark?.comparison?.reason === null && benchmark.enabledSymbols.length > 0;
  const minimalPlot = plotPresentation === "minimal" && !benchmarkVisible;
  const compactDateAxis = dateAxisPresentation === "compact";
  const firstYear = points[0]?.day.slice(0, 4) ?? "";
  const lastYear = points.at(-1)?.day.slice(0, 4) ?? "";
  const formatAxisDay = firstYear !== lastYear ? (day: string) => day : formatDay;
  const dateAxis = minimalPlot ? (
    <XAxis dataKey="day" hide />
  ) : compactDateAxis ? (
    <CalendarAssetTrendXAxis points={points} />
  ) : (
    <XAxis
      axisLine={{ stroke: "var(--line-2)" }}
      dataKey="day"
      interval="preserveStartEnd"
      minTickGap={40}
      tick={AssetTrendDateTick}
      tickFormatter={formatAxisDay}
      tickLine={{ stroke: "var(--line-2)" }}
    />
  );
  const benchmarkLegend = benchmark ? (
    <div
      aria-hidden={!benchmarkVisible && !benchmark.returnComparison}
      aria-label="已显示曲线"
      className="investment-performance__benchmark-series"
    >
      <span className="investment-performance__benchmark-series--assets">
        我的
        {benchmark.returnComparison
          ? `${benchmark.assetScopeLabel}收益率`
          : assetLabel(benchmark.assetScopeLabel)}
      </span>
      {benchmarkVisible && benchmark.enabledSymbols.includes(".SPX.US") ? (
        <span className="investment-performance__benchmark-series--spx">
          {marketBenchmarkLabel(".SPX.US")}
        </span>
      ) : null}
      {benchmarkVisible && benchmark.enabledSymbols.includes(".NDX.US") ? (
        <span className="investment-performance__benchmark-series--ndx">
          {marketBenchmarkLabel(".NDX.US")}
        </span>
      ) : null}
    </div>
  ) : null;
  if (
    benchmark !== undefined &&
    benchmark !== null &&
    benchmark.comparison !== null &&
    benchmark.comparison.reason === null &&
    benchmark.enabledSymbols.length > 0
  ) {
    // Hook-free renderers keep the Recharts tree mounted when the mode changes.
    return renderBenchmarkPlot({
      benchmark: { ...benchmark, comparison: benchmark.comparison },
      points,
      currency,
      formatAmount,
      isSensitiveHidden,
      variant,
      chartHeight,
      showDotFill,
      lineType,
      dateAxis,
      benchmarkLegend,
      dotFillId,
      glowId,
    });
  }
  return renderValuePlot({
    ariaLabel,
    currency,
    formatAmount,
    isSensitiveHidden,
    historicalSeries,
    emptyMessage,
    points,
    showCurrency,
    showDotFill,
    lineType,
    variant,
    chartHeight,
    dateAxis,
    benchmarkLegend,
    dotFillId,
    glowId,
    minimalPlot,
  });
}
