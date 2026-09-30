"use client";

import { useEffect, useState, type ComponentProps } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useIsTooltipActive,
  type TooltipContentProps,
} from "recharts";

import {
  marketBenchmarkLabel,
  type MarketBenchmarkComparison,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";

export type AssetTrendChartPoint = {
  amount: string | null;
  day: string;
  manualRecordDay?: string;
  observed: boolean;
  status: "complete" | "incomplete" | "expired";
};

type ChartDatum = AssetTrendChartPoint & {
  historicalAmount: string | null;
  historicalLabel: string | null;
  historicalValue: number | null;
  value: number | null;
};

type BenchmarkChartDatum = AssetTrendChartPoint & {
  ".NDX.US": number | null;
  ".SPX.US": number | null;
  assets: number | null;
};

type AssetTrendBenchmark = {
  assetScopeLabel: string;
  comparison: MarketBenchmarkComparison | null;
  enabledSymbols: MarketBenchmarkSymbol[];
};

function assetLabel(assetScopeLabel: string): string {
  return assetScopeLabel.endsWith("资产")
    ? assetScopeLabel
    : `${assetScopeLabel}资产`;
}

function percentage(value: number, signed = false): string {
  const normalized = Math.abs(value) < 0.000_000_1 ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${(normalized * 100).toFixed(2)}%`;
}

function TrendChartTooltip(props: ComponentProps<typeof Tooltip>) {
  const isActive = useIsTooltipActive();
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    setCanAnimate(false);
    if (!isActive) return;

    // Let Recharts measure and paint the initial position before animating moves.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setCanAnimate(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive]);

  return (
    <Tooltip
      {...props}
      filterNull={false}
      isAnimationActive={isActive && canAnimate ? "auto" : false}
      animationDuration={200}
      animationEasing="ease-in-out"
    />
  );
}

function HiddenTrendState({
  variant,
}: {
  variant: "source" | "total";
}) {
  return (
    <div
      className={`asset-trend-private asset-trend-private--${variant}`}
      role="status"
    >
      <div className="asset-trend-private-copy">
        <p>趋势已隐藏</p>
        <strong aria-hidden="true">••••••</strong>
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  currency,
  formatAmount,
  formatDay,
  payload,
  showCurrency,
}: TooltipContentProps & {
  currency: string;
  formatAmount(value: string): string;
  formatDay(day: string): string;
  showCurrency: boolean;
}) {
  const point = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !point) return null;
  const amount = point.amount ?? point.historicalAmount;
  const showingHistorical = point.amount === null && point.historicalAmount !== null;
  const quality = point.status === "expired"
    ? "过期"
    : point.status === "incomplete"
      ? "不完整"
      : null;

  return (
    <div className="asset-trend-tooltip">
      <span>{formatDay(point.day)}</span>
      <strong>
        {amount === null
          ? "未估值"
          : `${showingHistorical ? `${point.historicalLabel} ` : ""}${formatAmount(amount)}${showCurrency ? ` ${currency}` : ""}`}
      </strong>
      {showingHistorical ? <small>早期记录</small> : null}
      {quality ? <small>{quality}</small> : null}
      {point.manualRecordDay && point.manualRecordDay !== point.day ? (
        <small>{formatDay(point.manualRecordDay)} 记录</small>
      ) : null}
    </div>
  );
}

function BenchmarkTrendTooltip({
  active,
  assetScopeLabel,
  currency,
  enabledSymbols,
  formatAmount,
  formatDay,
  payload,
}: TooltipContentProps & {
  assetScopeLabel: string;
  currency: string;
  enabledSymbols: MarketBenchmarkSymbol[];
  formatAmount(value: string): string;
  formatDay(day: string): string;
}) {
  const point = payload?.[0]?.payload as BenchmarkChartDatum | undefined;
  if (!active || point === undefined) return null;
  const assetsLabel = assetLabel(assetScopeLabel);

  return (
    <div className="asset-trend-tooltip">
      <span>{formatDay(point.day)}</span>
      <strong>
        我的{assetsLabel} {point.assets === null ? "数据不足" : percentage(point.assets, true)}
      </strong>
      {point.amount === null ? (
        <small>资产金额未估值</small>
      ) : (
        <small>{formatAmount(point.amount)} {currency}</small>
      )}
      {enabledSymbols.map((symbol) => (
        <strong key={symbol}>
          {marketBenchmarkLabel(symbol)} {point[symbol] === null ? "数据不足" : percentage(point[symbol], true)}
        </strong>
      ))}
    </div>
  );
}

function QualitySummary({
  historicalLabel,
  historicalObserved,
  incompleteCount,
  observed,
  total,
  unavailableCount,
}: {
  historicalLabel?: string | null;
  historicalObserved?: number;
  incompleteCount: number;
  observed: number;
  total: number;
  unavailableCount: number;
}) {
  return (
    <p className="asset-trend-quality">
      完整 {observed} / {total} 天
      {historicalObserved && historicalLabel
        ? ` · ${historicalLabel} ${historicalObserved} 条`
        : ""}
      {incompleteCount > 0 ? ` · ${incompleteCount} 天不完整或过期` : ""}
      {unavailableCount > 0 ? ` · ${unavailableCount} 天未估值` : ""}
    </p>
  );
}

export function AssetTrendChart({
  ariaLabel,
  benchmark,
  chartHeight,
  currency,
  formatAmount,
  formatDay,
  incompleteCount,
  isSensitiveHidden = false,
  historicalSeries = null,
  points,
  showCurrency = true,
  lineType = "linear",
  unavailableCount,
  variant = "total",
}: {
  ariaLabel: string;
  benchmark?: AssetTrendBenchmark | null;
  chartHeight?: number;
  currency: string;
  formatAmount(value: string): string;
  formatDay(day: string): string;
  incompleteCount: number;
  isSensitiveHidden?: boolean;
  historicalSeries?: {
    label: string;
    points: AssetTrendChartPoint[];
  } | null;
  points: AssetTrendChartPoint[];
  showCurrency?: boolean;
  lineType?: "linear" | "stepAfter";
  unavailableCount: number;
  variant?: "source" | "total";
}) {
  if (isSensitiveHidden) {
    return <HiddenTrendState variant={variant} />;
  }

  const historicalByDay = new Map(
    historicalSeries?.points.map((point) => [point.day, point]) ?? [],
  );
  const data: ChartDatum[] = points.map((point) => {
    const historicalPoint = historicalByDay.get(point.day);
    return {
      ...point,
      historicalAmount: historicalPoint?.amount ?? null,
      historicalLabel: historicalPoint?.amount === null || historicalPoint === undefined
        ? null
        : historicalSeries?.label ?? null,
      historicalValue: historicalPoint?.amount === null || historicalPoint === undefined
        ? null
        : Number(historicalPoint.amount),
      value: point.amount === null ? null : Number(point.amount),
    };
  });
  const observed = data.filter((point) => point.amount !== null).length;
  const historicalObserved = data.filter((point) => point.historicalValue !== null).length;
  const today = data.at(-1);
  const values = data.flatMap((point) => [
    ...(point.value === null ? [] : [point.value]),
    ...(point.historicalValue === null ? [] : [point.historicalValue]),
  ]);
  const comparisonHeader = variant === "total" ? (
    <header className="asset-trend-comparison-header">
      <QualitySummary
        historicalLabel={historicalSeries?.label ?? null}
        historicalObserved={historicalObserved}
        incompleteCount={incompleteCount}
        observed={observed}
        total={points.length}
        unavailableCount={unavailableCount}
      />
    </header>
  ) : null;
  const benchmarkVisible = benchmark?.comparison?.reason === null &&
    benchmark.enabledSymbols.length > 0;
  const benchmarkLegend = benchmark ? (
    <div
      aria-hidden={!benchmarkVisible}
      aria-label="已显示曲线"
      className="investment-performance__benchmark-series"
    >
      <span className="investment-performance__benchmark-series--assets">
        我的{assetLabel(benchmark.assetScopeLabel)}
      </span>
      {benchmark.enabledSymbols.includes(".SPX.US") ? (
        <span className="investment-performance__benchmark-series--spx">
          {marketBenchmarkLabel(".SPX.US")}
        </span>
      ) : null}
      {benchmark.enabledSymbols.includes(".NDX.US") ? (
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
    const benchmarkComparison = benchmark.comparison;
    const comparisonByDay = new Map(
      benchmarkComparison.points.map((point) => [point.day, point]),
    );
    const benchmarkData: BenchmarkChartDatum[] = points.map((point) => {
      const comparisonPoint = comparisonByDay.get(point.day);
      return {
        ...point,
        ".NDX.US": comparisonPoint?.[".NDX.US"] === null || comparisonPoint === undefined
          ? null
          : Number(comparisonPoint[".NDX.US"]),
        ".SPX.US": comparisonPoint?.[".SPX.US"] === null || comparisonPoint === undefined
          ? null
          : Number(comparisonPoint[".SPX.US"]),
        assets: comparisonPoint === undefined ? null : Number(comparisonPoint.assets),
      };
    });
    const benchmarkValues = benchmarkData.flatMap((point) => [
      ...(point.assets === null ? [] : [point.assets]),
      ...benchmark.enabledSymbols.flatMap((symbol) =>
        point[symbol] === null ? [] : [point[symbol]!],
      ),
    ]);
    const benchmarkMinimum = Math.min(...benchmarkValues);
    const benchmarkMaximum = Math.max(...benchmarkValues);
    const benchmarkPadding = benchmarkMaximum === benchmarkMinimum
      ? Math.max(Math.abs(benchmarkMaximum) * 0.1, 0.01)
      : (benchmarkMaximum - benchmarkMinimum) * 0.08;
    const assetsLabel = assetLabel(benchmark.assetScopeLabel);

    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        {comparisonHeader}
        {benchmarkLegend}
        <div className="total-trend-chart-wrap">
          <ResponsiveContainer
            width="100%"
            height={chartHeight ?? (variant === "source" ? 168 : 300)}
          >
            <LineChart
              accessibilityLayer
              aria-label={`${assetsLabel}与市场价格指数趋势`}
              data={benchmarkData}
              margin={{
                top: 12,
                right: variant === "source" ? 12 : 20,
                bottom: 6,
                left: 0,
              }}
              role="img"
            >
              <CartesianGrid
                horizontal
                vertical={false}
                stroke="var(--line)"
                strokeDasharray="0"
              />
              <XAxis
                axisLine={{ stroke: "var(--line-2)" }}
                dataKey="day"
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{
                  fill: "var(--muted)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 10,
                }}
                tickFormatter={formatDay}
                tickLine={{ stroke: "var(--line-2)" }}
              />
              <YAxis
                axisLine={false}
                domain={[benchmarkMinimum - benchmarkPadding, benchmarkMaximum + benchmarkPadding]}
                tick={{
                  fill: "var(--muted)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 10,
                }}
                tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                tickLine={false}
                width={56}
              />
              <TrendChartTooltip
                content={(props) => (
                  <BenchmarkTrendTooltip
                    {...props}
                    assetScopeLabel={benchmark.assetScopeLabel}
                    currency={currency}
                    enabledSymbols={benchmark.enabledSymbols}
                    formatAmount={formatAmount}
                    formatDay={formatDay}
                  />
                )}
                cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
              />
              <ReferenceLine stroke="var(--line-2)" strokeWidth={1} y={0} />
              <Line
                activeDot={false}
                connectNulls
                dataKey="assets"
                dot={false}
                isAnimationActive={false}
                name={`我的${assetsLabel}`}
                stroke="var(--display)"
                strokeLinecap="square"
                strokeWidth={2}
                type={lineType}
              />
              {benchmark.enabledSymbols.includes(".SPX.US") ? (
                <Line
                  activeDot={false}
                  connectNulls
                  dataKey=".SPX.US"
                  dot={false}
                  isAnimationActive={false}
                  name={marketBenchmarkLabel(".SPX.US")}
                  stroke="var(--secondary)"
                  strokeLinecap="square"
                  strokeWidth={2}
                  type="linear"
                />
              ) : null}
              {benchmark.enabledSymbols.includes(".NDX.US") ? (
                <Line
                  activeDot={false}
                  connectNulls
                  dataKey=".NDX.US"
                  dot={false}
                  isAnimationActive={false}
                  name={marketBenchmarkLabel(".NDX.US")}
                  stroke="var(--muted)"
                  strokeDasharray="5 4"
                  strokeLinecap="square"
                  strokeWidth={2}
                  type="linear"
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (values.length === 0) {
    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        {comparisonHeader}
        <p className="trend-empty">无可用趋势</p>
      </div>
    );
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = maximum === minimum
    ? Math.max(Math.abs(maximum) * 0.1, 1)
    : (maximum - minimum) * 0.08;
  const axisMinimum = minimum - padding;
  const axisMaximum = maximum + padding;
  const compactAxisValue = (value: number) =>
    Math.abs(value) >= 1_000
      ? `${Math.round(value / 1_000)}k`
      : Math.round(value).toLocaleString();

  return (
    <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
      {comparisonHeader}
      {benchmarkLegend}
      <div className="total-trend-chart-wrap">
        <ResponsiveContainer
          width="100%"
          height={chartHeight ?? (variant === "source" ? 168 : 300)}
        >
          <LineChart
            accessibilityLayer
            aria-label={ariaLabel}
            data={data}
            margin={{
              top: 12,
              right: variant === "source" ? 12 : 20,
              bottom: 6,
              left: 0,
            }}
            role="img"
          >
            <CartesianGrid
              horizontal
              vertical={false}
              stroke="var(--line)"
              strokeDasharray="0"
            />
            <XAxis
              axisLine={{ stroke: "var(--line-2)" }}
              dataKey="day"
              minTickGap={40}
              tick={{
                fill: "var(--muted)",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
              }}
              tickFormatter={formatDay}
              tickLine={{ stroke: "var(--line-2)" }}
            />
            <YAxis
              axisLine={false}
              domain={[axisMinimum, axisMaximum]}
              tick={{
                fill: "var(--muted)",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
              }}
              tickFormatter={compactAxisValue}
              tickLine={false}
              width={variant === "source" ? 48 : 56}
            />
            <TrendChartTooltip
              content={(props) => (
                <TrendTooltip
                  {...props}
                  currency={currency}
                  formatAmount={formatAmount}
                  formatDay={formatDay}
                  showCurrency={showCurrency}
                />
              )}
              cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
            />
            {today?.amount != null ? (
              <ReferenceLine
                stroke="var(--secondary)"
                strokeWidth={1}
                x={today.day}
              />
            ) : null}
            {historicalObserved > 0 ? (
              <Line
                activeDot={false}
                connectNulls
                dataKey="historicalValue"
                dot={false}
                isAnimationActive={false}
                name={historicalSeries?.label}
                stroke="var(--secondary)"
                strokeDasharray="5 4"
                strokeLinecap="square"
                strokeWidth={2}
                type={lineType}
              />
            ) : null}
            <Line
              activeDot={false}
              connectNulls
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke="var(--display)"
              strokeLinecap="square"
              strokeWidth={2}
              type={lineType}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
