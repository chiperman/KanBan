import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";

import { marketBenchmarkLabel, type MarketBenchmarkComparison } from "@/domain/market-benchmark";

import { FundingEventLegend, FundingEventOverlay } from "./funding-events";
import { CurveLine, TrendEffects } from "./plot-parts";
import type {
  AssetTrendBenchmark,
  AssetTrendChartPoint,
  BenchmarkChartDatum,
  ResolvedChartProps,
} from "./shared";
import {
  assetLabel,
  percentage,
  TREND_CHART_ANIMATION_DURATION,
  TREND_CHART_AXIS_INSET,
} from "./shared";
import {
  benchmarkTooltipRows,
  TrendChartSurface,
  TrendChartTooltip,
  TrendTooltip,
  trendTooltipSizing,
} from "./tooltip";

import type { PlotFrameProps } from "./shared";

type BenchmarkPlotProps = Pick<
  ResolvedChartProps,
  | "currency"
  | "formatAmount"
  | "isSensitiveHidden"
  | "variant"
  | "chartHeight"
  | "showDotFill"
  | "lineType"
> &
  PlotFrameProps & {
    benchmark: AssetTrendBenchmark & { comparison: MarketBenchmarkComparison };
    points: AssetTrendChartPoint[];
  };

export function renderBenchmarkPlot({
  benchmark,
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
}: BenchmarkPlotProps) {
  const benchmarkComparison = benchmark.comparison;
  const comparisonByDay = new Map(benchmarkComparison.points.map((point) => [point.day, point]));
  const benchmarkData: BenchmarkChartDatum[] = points.map((point) => {
    const comparisonPoint = comparisonByDay.get(point.day);
    return {
      ...point,
      ".NDX.US":
        comparisonPoint?.[".NDX.US"] === null || comparisonPoint === undefined
          ? null
          : Number(comparisonPoint[".NDX.US"]),
      ".SPX.US":
        comparisonPoint?.[".SPX.US"] === null || comparisonPoint === undefined
          ? null
          : Number(comparisonPoint[".SPX.US"]),
      assets: comparisonPoint?.assets == null ? null : Number(comparisonPoint.assets),
    };
  });
  const benchmarkLastValueIndex = benchmarkData.reduce(
    (lastIndex, point, index) => (point.assets === null ? lastIndex : index),
    -1,
  );
  const benchmarkValues = benchmarkData.flatMap((point) => [
    ...(point.assets === null ? [] : [point.assets]),
    ...benchmark.enabledSymbols.flatMap((symbol) =>
      point[symbol] === null ? [] : [point[symbol]!],
    ),
  ]);
  const benchmarkMinimum = Math.min(...benchmarkValues);
  const benchmarkMaximum = Math.max(...benchmarkValues);
  const benchmarkPadding =
    benchmarkMaximum === benchmarkMinimum
      ? Math.max(Math.abs(benchmarkMaximum) * 0.1, 0.01)
      : (benchmarkMaximum - benchmarkMinimum) * 0.08;
  const assetsLabel = benchmark.returnComparison
    ? `${benchmark.assetScopeLabel}收益率`
    : assetLabel(benchmark.assetScopeLabel);
  const tooltipRows = (point: BenchmarkChartDatum) =>
    benchmarkTooltipRows(point, {
      assetScopeLabel: benchmark.assetScopeLabel,
      currency,
      enabledSymbols: benchmark.enabledSymbols,
      formatAmount,
      isSensitiveHidden,
      returnComparison: benchmark.returnComparison,
    });
  const tooltipSizing = trendTooltipSizing(benchmarkData.map(tooltipRows));

  return (
    <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
      {benchmarkLegend}
      <TrendChartSurface>
        <ResponsiveContainer
          width="100%"
          height={chartHeight ?? (variant === "source" ? 168 : 300)}
        >
          <ComposedChart
            accessibilityLayer
            aria-label={`${assetsLabel}与市场价格指数趋势`}
            data={benchmarkData}
            margin={{
              top: 12,
              right: variant === "source" ? 12 : 20,
              bottom: 6,
              left: TREND_CHART_AXIS_INSET,
            }}
            role="img"
          >
            <TrendEffects dotsId={dotFillId} glowId={glowId} />
            <CartesianGrid horizontal vertical={false} stroke="var(--line)" strokeDasharray="0" />
            {dateAxis}
            <YAxis
              axisLine={false}
              domain={[benchmarkMinimum - benchmarkPadding, benchmarkMaximum + benchmarkPadding]}
              tick={{
                className: "asset-trend-axis-tick",
                fill: "var(--muted)",
                fontFamily: "var(--f-display)",
                fontSize: 12,
                fontWeight: 500,
              }}
              tickFormatter={(value: number) => (isSensitiveHidden ? "••••••" : percentage(value))}
              tickLine={false}
              width="auto"
            />
            <TrendChartTooltip
              content={(props) => (
                <TrendTooltip {...props} rowsForPoint={tooltipRows} sizing={tooltipSizing} />
              )}
            />
            <ReferenceLine stroke="var(--line-2)" strokeWidth={1} y={0} />
            {showDotFill ? (
              <Area
                activeDot={false}
                baseValue={benchmarkMinimum - benchmarkPadding}
                connectNulls
                dataKey="assets"
                dot={false}
                fill={`url(#${dotFillId})`}
                fillOpacity={1}
                animationDuration={TREND_CHART_ANIMATION_DURATION}
                animationEasing="ease-out"
                isAnimationActive={false}
                stroke="none"
                type={lineType}
              />
            ) : null}
            <CurveLine
              activeDot
              dataKey="assets"
              filter={`url(#${glowId})`}
              name={`我的${assetsLabel}`}
              stroke="var(--display)"
              type={lineType}
            />
            {benchmark.enabledSymbols.includes(".SPX.US") ? (
              <CurveLine
                dataKey=".SPX.US"
                name={marketBenchmarkLabel(".SPX.US")}
                stroke="var(--benchmark-spx)"
              />
            ) : null}
            {benchmark.enabledSymbols.includes(".NDX.US") ? (
              <CurveLine
                dataKey=".NDX.US"
                name={marketBenchmarkLabel(".NDX.US")}
                stroke="var(--benchmark-ndx)"
                strokeDasharray="1 6"
                strokeWidth={2.8}
              />
            ) : null}
            {benchmarkLastValueIndex >= 0 &&
            !benchmarkData[benchmarkLastValueIndex].events?.length ? (
              <ReferenceDot
                fill="var(--surface)"
                r={5}
                stroke="var(--display)"
                strokeWidth={2.4}
                x={benchmarkData[benchmarkLastValueIndex].day}
                y={benchmarkData[benchmarkLastValueIndex].assets!}
              />
            ) : null}
            {benchmarkData.some((point) => point.events?.length) ? (
              <FundingEventOverlay points={benchmarkData} dataKey="assets" type={lineType} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </TrendChartSurface>
      <FundingEventLegend points={benchmarkData} />
    </div>
  );
}
