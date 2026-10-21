"use client";

import { useEffect, useId, useState, type ComponentProps } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useIsTooltipActive,
  usePlotArea,
  type TooltipContentProps,
  type XAxisTickContentProps,
} from "recharts";

import {
  marketBenchmarkLabel,
  type MarketBenchmarkComparison,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import { formatShanghaiFullDayLabel } from "@/ui/shanghai-date-time";
import { TrendDotPattern } from "@/ui/trend-dot-pattern";

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
  returnComparison?: boolean;
};

type CurveLineProps = {
  dataKey: string;
  stroke: string;
  type?: "linear" | "monotone" | "stepAfter";
  activeDot?: boolean;
  connectNulls?: boolean;
  dot?: boolean;
  filter?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  name?: string;
};

/* The reference screenshot uses one continuous curve with a single
   end marker; the end dot is presentational and never participates in
   tooltip data. */
function CurveLine({
  dataKey,
  stroke,
  type = "monotone",
  activeDot = false,
  connectNulls = true,
  dot = false,
  filter,
  strokeDasharray,
  strokeWidth = 2.4,
  name,
}: CurveLineProps) {
  return (
    <Line
      activeDot={activeDot ? {
        r: 5,
        fill: "var(--surface)",
        stroke,
        strokeWidth: 2.5,
      } : false}
      connectNulls={connectNulls}
      dataKey={dataKey}
      dot={dot}
      filter={filter}
      isAnimationActive={false}
      name={name}
      stroke={stroke}
      strokeDasharray={strokeDasharray}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      type={type}
    />
  );
}

function TrendEffects({ dotsId, glowId }: { dotsId: string; glowId: string }) {
  const plotArea = usePlotArea();
  return (
    <defs>
      {plotArea ? <TrendDotPattern
        height={plotArea.height}
        id={dotsId}
        top={plotArea.y}
      /> : null}
      {plotArea ? <filter
        colorInterpolationFilters="sRGB"
        filterUnits="userSpaceOnUse"
        height={plotArea.height + 48}
        id={glowId}
        width={plotArea.width + 48}
        x={plotArea.x - 24}
        y={plotArea.y - 24}
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
        <feComponentTransfer result="wideGlow">
          <feFuncA slope="0.24" type="linear" />
        </feComponentTransfer>
        <feGaussianBlur in="SourceGraphic" result="nearGlow" stdDeviation="2" />
        <feComponentTransfer in="nearGlow" result="softGlow">
          <feFuncA slope="0.4" type="linear" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="wideGlow" />
          <feMergeNode in="softGlow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter> : null}
    </defs>
  );
}

function TrendExtentLabels({ minimum, maximum }: { minimum: string; maximum: string }) {
  const plotArea = usePlotArea();
  if (!plotArea) return null;
  return <g fill="var(--secondary)" fontFamily="var(--f-mono)" fontSize={12}>
    <text x={plotArea.x} y={plotArea.y - 12}>{maximum}</text>
    {minimum !== maximum ? <text x={plotArea.x} y={plotArea.y + plotArea.height + 20}>{minimum}</text> : null}
  </g>;
}

export function AssetTrendDateTick({ x, y, index, visibleTicksCount, payload, tickFormatter }: XAxisTickContentProps) {
  return <text
    className="recharts-cartesian-axis-tick-value"
    x={x}
    y={y}
    dy="0.71em"
    fill="var(--muted)"
    fontFamily="var(--f-mono)"
    fontSize={10}
    textAnchor={visibleTicksCount === 1 ? "middle" : index === 0 ? "start" : index === visibleTicksCount - 1 ? "end" : "middle"}
  >{tickFormatter ? tickFormatter(payload.value, index) : payload.value}</text>;
}

type CalendarDateTick = {
  day: string;
  label: string;
  year: string | null;
  textAnchor: "start" | "middle" | "end";
};

export function calendarAssetTrendTicks(days: readonly string[], plotWidth: number): CalendarDateTick[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days.at(-1)!;
  const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  const monthly = spanDays > 62;
  const width = Math.max(0, plotWidth);
  const minGap = monthly ? 44 : 56;
  const steps = monthly ? [1, 2, 3, 6, 12, 24, 60, 120] : [1, 2, 3, 7, 14, 28, 56];
  const position = (index: number) => days.length === 1 ? width / 2 : index / (days.length - 1) * width;
  const candidatesForStep = (step: number) => days.flatMap((day, index) => {
    if (index === 0) return [{ day, index }];
    if (monthly) {
      const month = Number(day.slice(5, 7)) - 1;
      const monthIndex = Number(day.slice(0, 4)) * 12 + month;
      return day.slice(0, 7) !== days[index - 1].slice(0, 7) && monthIndex % step === 0
        ? [{ day, index }]
        : [];
    }
    const offset = (Date.parse(day) - Date.parse(first)) / 86_400_000;
    return offset % step === 0 || day.endsWith("-01-01") || index === days.length - 1
      ? [{ day, index }]
      : [];
  });
  // Measure actual calendar spacing so February does not break an otherwise monthly cadence.
  const step = steps.find(value => {
    if (!monthly) return spanDays / value * minGap <= width;
    const regularTicks = candidatesForStep(value).slice(1);
    return regularTicks.slice(1).every((tick, index) =>
      position(tick.index) - position(regularTicks[index].index) >= minGap,
    );
  }) ?? steps.at(-1)!;
  const candidates = candidatesForStep(step);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (previous && position(candidate.index) - position(previous.index) < minGap) {
      const entersYear = candidate.day.slice(0, 4) !== previous.day.slice(0, 4);
      const finalDay = !monthly && candidate.day === last && selected.length > 1;
      if (!entersYear && !finalDay) continue;
      // Keep the year boundary (or short-range endpoint), not a nearby redundant label.
      selected.pop();
    }
    selected.push(candidate);
  }
  return selected.map(({ day, index }, tickIndex) => ({
    day,
    label: monthly ? `${Number(day.slice(5, 7))}月` : day.slice(5).replace("-", "."),
    year: tickIndex === 0 || day.slice(0, 4) !== selected[tickIndex - 1].day.slice(0, 4)
      ? day.slice(0, 4)
      : null,
    textAnchor: position(index) < minGap / 2 ? "start"
      : position(index) > width - minGap / 2 ? "end" : "middle",
  }));
}

export function CompactAssetTrendDateTick(props: XAxisTickContentProps & { dateTicks: CalendarDateTick[] }) {
  const dateTick = props.dateTicks.find(tick => tick.day === String(props.payload.value));
  if (!dateTick) return null;
  const tick = AssetTrendDateTick(props);
  return <text {...tick.props} textAnchor={dateTick.textAnchor}>
    <tspan x={props.x}>{dateTick.label}</tspan>
    {dateTick.year ? <tspan x={props.x} dy="1.5em">{dateTick.year}</tspan> : null}
  </text>;
}

export function CalendarAssetTrendXAxis({ points }: { points: AssetTrendChartPoint[] }) {
  const plotArea = usePlotArea();
  const dateTicks = calendarAssetTrendTicks(points.map(point => point.day), plotArea?.width ?? 0);
  return <XAxis
    axisLine={{ stroke: "var(--line-2)" }}
    dataKey="day"
    height={44}
    interval={0}
    ticks={dateTicks.map(tick => tick.day)}
    tick={props => <CompactAssetTrendDateTick {...props} dateTicks={dateTicks} />}
    tickFormatter={day => dateTicks.find(tick => tick.day === day)?.label ?? day}
    tickLine={{ stroke: "var(--line-2)" }}
  />;
}

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
  returnComparison,
}: TooltipContentProps & {
  assetScopeLabel: string;
  currency: string;
  enabledSymbols: MarketBenchmarkSymbol[];
  formatAmount(value: string): string;
  formatDay(day: string): string;
  returnComparison?: boolean;
}) {
  const point = payload?.[0]?.payload as BenchmarkChartDatum | undefined;
  if (!active || point === undefined) return null;
  const assetsLabel = returnComparison ? `${assetScopeLabel}收益率` : assetLabel(assetScopeLabel);

  return (
    <div className="asset-trend-tooltip">
      <span>{formatDay(point.day)}</span>
      <strong>
        我的{assetsLabel} {point.assets === null ? "数据不足" : percentage(point.assets, true)}
      </strong>
      {returnComparison ? null : point.amount === null ? (
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
  missingCount,
  observed,
  total,
  unavailableCount,
}: {
  historicalLabel?: string | null;
  historicalObserved?: number;
  incompleteCount: number;
  missingCount: number;
  observed: number;
  total: number;
  unavailableCount: number;
}) {
  return (
    <p
      className="asset-trend-quality"
      data-coverage={`${observed}/${total}`}
    >
      完整 {observed} / {total} 天
      {historicalObserved && historicalLabel
        ? ` · ${historicalLabel} ${historicalObserved} 条`
        : ""}
      {incompleteCount > 0 ? ` · ${incompleteCount} 天不完整或过期` : ""}
      {unavailableCount > 0 ? ` · ${unavailableCount} 天未估值` : ""}
      {missingCount > 0 ? ` · 缺少 ${missingCount} 天观测` : ""}
    </p>
  );
}

export function AssetTrendChart({
  ariaLabel,
  benchmark,
  chartHeight,
  coverageNote,
  coveragePresentation = "default",
  currency,
  dateAxisPresentation = "default",
  formatAmount,
  formatDay,
  incompleteCount,
  isSensitiveHidden = false,
  historicalSeries = null,
  emptyMessage = "无可用趋势",
  points,
  showCurrency = true,
  showDotFill = true,
  lineType = "monotone",
  plotPresentation = "default",
  unavailableCount,
  variant = "total",
}: {
  ariaLabel: string;
  benchmark?: AssetTrendBenchmark | null;
  chartHeight?: number;
  coverageNote?: string;
  coveragePresentation?: "default" | "disclosure" | "none";
  currency: string;
  dateAxisPresentation?: "default" | "compact";
  formatAmount(value: string): string;
  formatDay(day: string): string;
  incompleteCount: number;
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
  unavailableCount: number;
  variant?: "source" | "total";
}) {
  const dotFillId = `asset-trend-dots-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const glowId = `${dotFillId}-glow`;

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
  const observed = data.filter((point) => (point.observed || point.manualRecordDay) && point.amount !== null && point.status === "complete").length;
  const missingCount = data.filter((point) => !point.observed && !point.manualRecordDay && point.historicalAmount === null).length;
  const historicalObserved = data.filter((point) => point.historicalValue !== null).length;
  const today = data.at(-1);
  const amounts = data.flatMap((point) => [
    ...(point.amount === null ? [] : [point.amount]),
    ...(point.historicalAmount === null ? [] : [point.historicalAmount]),
  ]);
  const values = amounts.map(Number);
  const qualitySummary = <QualitySummary
    historicalLabel={historicalSeries?.label ?? null}
    historicalObserved={historicalObserved}
    incompleteCount={incompleteCount}
    missingCount={missingCount}
    observed={observed}
    total={points.length}
    unavailableCount={unavailableCount}
  />;
  const comparisonHeader = coveragePresentation === "none" ? null : coveragePresentation === "disclosure" ? (
    <details className="asset-trend-coverage">
      <summary>数据覆盖{missingCount + incompleteCount + unavailableCount > 0 ? " · 存在缺测或不完整记录" : ""}</summary>
      {coverageNote ? <p className="asset-trend-coverage-note">{coverageNote}</p> : null}
      {qualitySummary}
    </details>
  ) : (
    <header className="asset-trend-comparison-header">
      {coverageNote ? <p className="asset-trend-coverage-note">{coverageNote}</p> : null}
      {qualitySummary}
    </header>
  );
  const benchmarkVisible = benchmark?.comparison?.reason === null &&
    benchmark.enabledSymbols.length > 0;
  const minimalPlot = plotPresentation === "minimal" && !benchmarkVisible;
  const compactDateAxis = dateAxisPresentation === "compact";
  const firstYear = points[0]?.day.slice(0, 4) ?? "";
  const lastYear = points.at(-1)?.day.slice(0, 4) ?? "";
  const formatAxisDay = firstYear !== lastYear
    ? (day: string) => day
    : formatDay;
  const dateAxis = minimalPlot ? <XAxis dataKey="day" hide /> : compactDateAxis ? <CalendarAssetTrendXAxis points={points} /> : (
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
      aria-hidden={!benchmarkVisible}
      aria-label="已显示曲线"
      className="investment-performance__benchmark-series"
    >
      <span className="investment-performance__benchmark-series--assets">
        我的{benchmark.returnComparison ? `${benchmark.assetScopeLabel}收益率` : assetLabel(benchmark.assetScopeLabel)}
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
        assets: comparisonPoint?.assets == null ? null : Number(comparisonPoint.assets),
      };
    });
    const benchmarkLastValueIndex = benchmarkData.reduce(
      (lastIndex, point, index) => point.assets === null ? lastIndex : index,
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
    const benchmarkPadding = benchmarkMaximum === benchmarkMinimum
      ? Math.max(Math.abs(benchmarkMaximum) * 0.1, 0.01)
      : (benchmarkMaximum - benchmarkMinimum) * 0.08;
    const assetsLabel = benchmark.returnComparison ? `${benchmark.assetScopeLabel}收益率` : assetLabel(benchmark.assetScopeLabel);

    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        {coveragePresentation !== "disclosure" ? comparisonHeader : null}
        {benchmarkLegend}
        <div className="total-trend-chart-wrap">
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
                left: 0,
              }}
              role="img"
            >
              <TrendEffects dotsId={dotFillId} glowId={glowId} />
              <CartesianGrid
                horizontal
                vertical={false}
                stroke="var(--line)"
                strokeDasharray="0"
              />
              {dateAxis}
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
                    formatDay={formatShanghaiFullDayLabel}
                    returnComparison={benchmark.returnComparison}
                  />
                )}
                cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
              />
              <ReferenceLine stroke="var(--line-2)" strokeWidth={1} y={0} />
              {showDotFill ? <Area
                activeDot={false}
                baseValue={benchmarkMinimum - benchmarkPadding}
                connectNulls
                dataKey="assets"
                dot={false}
                fill={`url(#${dotFillId})`}
                fillOpacity={1}
                isAnimationActive={false}
                stroke="none"
                type={lineType}
              /> : null}
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
                  stroke="var(--secondary)"
                />
              ) : null}
              {benchmark.enabledSymbols.includes(".NDX.US") ? (
                <CurveLine
                  dataKey=".NDX.US"
                  name={marketBenchmarkLabel(".NDX.US")}
                  stroke="var(--muted)"
                  strokeDasharray="5 4"
                />
              ) : null}
              {benchmarkLastValueIndex >= 0 ? (
                <ReferenceDot
                  fill="var(--surface)"
                  r={5}
                  stroke="var(--display)"
                  strokeWidth={2.4}
                  x={benchmarkData[benchmarkLastValueIndex].day}
                  y={benchmarkData[benchmarkLastValueIndex].assets!}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {coveragePresentation === "disclosure" ? comparisonHeader : null}
      </div>
    );
  }

  if (values.length === 0) {
    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        {coveragePresentation !== "disclosure" ? comparisonHeader : null}
        <p className="trend-empty">{emptyMessage}</p>
        {coveragePresentation === "disclosure" ? comparisonHeader : null}
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
  const lastValueIndex = data.reduce(
    (lastIndex, point, index) => point.value === null ? lastIndex : index,
    -1,
  );

  return (
    <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
      {coveragePresentation !== "disclosure" ? comparisonHeader : null}
      {benchmarkLegend}
      <div className="total-trend-chart-wrap">
        <ResponsiveContainer
          width="100%"
          height={chartHeight ?? (variant === "source" ? 168 : 300)}
        >
          <ComposedChart
            accessibilityLayer
            aria-label={ariaLabel}
            data={data}
            margin={{
              top: minimalPlot ? 32 : 12,
              right: minimalPlot ? 8 : variant === "source" ? 12 : 20,
              bottom: minimalPlot ? 32 : 6,
              left: 0,
            }}
            role="img"
          >
            <TrendEffects dotsId={dotFillId} glowId={glowId} />
            {minimalPlot ? null : <CartesianGrid
              horizontal
              vertical={false}
              stroke="var(--line)"
              strokeDasharray="0"
            />}
            {dateAxis}
            <YAxis
              axisLine={false}
              domain={[axisMinimum, axisMaximum]}
              hide={minimalPlot}
              tick={{
                fill: "var(--muted)",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
              }}
              tickFormatter={compactAxisValue}
              tickLine={false}
              width={minimalPlot ? 0 : variant === "source" ? 48 : 56}
            />
            <TrendChartTooltip
              content={(props) => (
                <TrendTooltip
                  {...props}
                  currency={currency}
                  formatAmount={formatAmount}
                  formatDay={formatShanghaiFullDayLabel}
                  showCurrency={showCurrency}
                />
              )}
              cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
            />
            {!minimalPlot && today?.amount != null ? (
              <ReferenceLine
                stroke="var(--secondary)"
                strokeWidth={1}
                x={today.day}
              />
            ) : null}
            {historicalObserved > 0 ? (
              <CurveLine
                dot={historicalObserved === 1}
                dataKey="historicalValue"
                name={historicalSeries?.label}
                stroke="var(--secondary)"
                strokeDasharray="5 4"
                type={lineType}
              />
            ) : null}
            {showDotFill ? <Area
              activeDot={false}
              baseValue={axisMinimum}
              connectNulls
              dataKey="value"
              dot={false}
              fill={`url(#${dotFillId})`}
              fillOpacity={1}
              isAnimationActive={false}
              stroke="none"
              type={lineType}
            /> : null}
            <CurveLine
              activeDot
              dataKey="value"
              filter={`url(#${glowId})`}
              stroke="var(--display)"
              strokeWidth={minimalPlot ? 3 : 2.4}
              type={lineType}
            />
            {minimalPlot ? <TrendExtentLabels
              maximum={formatAmount(amounts[values.indexOf(maximum)])}
              minimum={formatAmount(amounts[values.indexOf(minimum)])}
            /> : null}
            {lastValueIndex >= 0 ? (
              <ReferenceDot
                fill="var(--surface)"
                r={5}
                stroke="var(--display)"
                strokeWidth={2.4}
                x={data[lastValueIndex].day}
                y={data[lastValueIndex].value!}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {coveragePresentation === "disclosure" ? comparisonHeader : null}
    </div>
  );
}
