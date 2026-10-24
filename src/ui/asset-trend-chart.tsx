"use client";

import { createContext, useContext, useId, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";
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
  useActiveTooltipCoordinate,
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
import { VibeLiveCounter } from "@/ui/vibe/vibe-live-counter";

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

const TREND_CHART_ANIMATION_DURATION = 200;
// Keep event shapes above the cursor and active dot.
const FUNDING_EVENT_Z_INDEX = 1300;

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

/* The end marker is presentational and never participates in tooltip data. */
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
      animationDuration={TREND_CHART_ANIMATION_DURATION}
      animationEasing="ease-out"
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

function TrendExtentLabels({ minimum, maximum, isSensitiveHidden }: {
  minimum: string;
  maximum: string;
  isSensitiveHidden: boolean;
}) {
  const plotArea = usePlotArea();
  if (!plotArea) return null;
  return <g
    className="asset-trend-extent-labels"
    fill="var(--secondary)"
    fontFamily="var(--f-display)"
    fontSize={12}
    fontWeight={500}
  >
    <text x={plotArea.x} y={plotArea.y - 12}>{isSensitiveHidden ? "••••••" : maximum}</text>
    {minimum !== maximum ? <text x={plotArea.x} y={plotArea.y + plotArea.height + 20}>{isSensitiveHidden ? "••••••" : minimum}</text> : null}
  </g>;
}

export function AssetTrendDateTick({ x, y, index, visibleTicksCount, payload, tickFormatter }: XAxisTickContentProps) {
  return <text
    className="recharts-cartesian-axis-tick-value"
    x={x}
    y={y}
    dy="0.71em"
    fill="var(--muted)"
    fontFamily="var(--f-display)"
    fontSize={12}
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

function formatTrendTooltipDay(day: string): string {
  // Keep number/CJK spacing explicit so later text spacing cannot change placement.
  return formatShanghaiFullDayLabel(day).replace(/([年月日])/g, " $1 ").trim();
}

const TREND_TOOLTIP_OFFSET = 10;

type TrendTooltipRow = {
  tag: "span" | "strong" | "small";
  text: string;
  unit?: string;
  series?: "spx" | "ndx";
  tone?: "deposit" | "withdrawal";
  counter?: { value: string; prefix?: string; suffix?: string };
};

function trendTooltipSizing(points: TrendTooltipRow[][]): string[][] {
  const rows: Set<string>[] = [];
  for (const point of points) {
    point.forEach(({ text, unit }, index) => {
      rows[index] ??= new Set();
      // Tabular digits share a width; keep only distinct text shapes for sizing.
      if (text) rows[index].add(`${text}${unit ? ` ${unit}` : ""}`.replace(/[0-9]/g, "0"));
    });
  }
  return rows.map(row => [...row]);
}

const TrendPointerContext = createContext<number | null>(null);

function TrendChartSurface({ children }: { children: ReactNode }) {
  const [pointerX, setPointerX] = useState<number | null>(null);

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    setPointerX((event.clientX - bounds.left) * event.currentTarget.clientWidth / bounds.width);
  }

  return <div
    className="total-trend-chart-wrap"
    onKeyDownCapture={() => setPointerX(null)}
    onPointerDown={trackPointer}
    onPointerLeave={() => setPointerX(null)}
    onPointerMove={trackPointer}
  >
    <TrendPointerContext value={pointerX}>{children}</TrendPointerContext>
  </div>;
}

function TrendChartCursor() {
  const pointerX = useContext(TrendPointerContext);
  const coordinate = useActiveTooltipCoordinate();
  const plotArea = usePlotArea();
  if (!plotArea || !coordinate) return null;
  const x = Math.max(plotArea.x, Math.min(pointerX ?? coordinate.x, plotArea.x + plotArea.width));

  return <line
    className="recharts-tooltip-cursor"
    pointerEvents="none"
    stroke="var(--line-2)"
    strokeWidth={1}
    x1={x}
    x2={x}
    y1={plotArea.y}
    y2={plotArea.y + plotArea.height}
  />;
}

function TrendChartTooltip(props: ComponentProps<typeof Tooltip>) {
  return (
    <Tooltip
      {...props}
      cursor={<TrendChartCursor />}
      filterNull={false}
      offset={TREND_TOOLTIP_OFFSET}
      isAnimationActive="auto"
      animationDuration={250}
      animationEasing="ease-out"
    />
  );
}

function hasTrendRecord(point: AssetTrendChartPoint): boolean {
  return point.observed || point.manualRecordDay === point.day;
}

function TrendTooltipSurface({ rows, sizing }: {
  rows: TrendTooltipRow[];
  sizing: string[][];
}) {
  return (
    <div className="asset-trend-tooltip">
      {rows.map(({ tag: Tag, text, unit, series, tone, counter }, index) => {
        const content = counter ? <>
          {counter.prefix}<VibeLiveCounter
            animate={false}
            value={counter.value}
          />{counter.suffix}
        </> : text;
        return sizing[index]?.length ? (
          <div className="asset-trend-tooltip-row" key={index}>
            {sizing[index].map(candidate => (
              <Tag aria-hidden="true" className="asset-trend-tooltip-sizer" key={candidate}>{candidate}</Tag>
            ))}
            <Tag className={[
              unit ? "asset-trend-tooltip-amount" : null,
              series ? `asset-trend-tooltip-series--${series}` : null,
              tone ? `asset-trend-tooltip-event--${tone}` : null,
            ].filter(Boolean).join(" ") || undefined}>
              {unit ? <><span>{content}</span>{" "}<span>{unit}</span></> : content}
            </Tag>
          </div>
        ) : null;
      })}
    </div>
  );
}

function trendTooltipRows(point: ChartDatum, {
  currency,
  formatAmount,
  isSensitiveHidden,
  showCurrency,
}: {
  currency: string;
  formatAmount(value: string): string;
  isSensitiveHidden: boolean;
  showCurrency: boolean;
}): TrendTooltipRow[] {
  const hasRecord = hasTrendRecord(point) || (point.events?.length ?? 0) > 0;
  const amount = hasRecord ? point.amount ?? point.historicalAmount : point.historicalAmount;
  const missing = !hasRecord && point.historicalAmount === null;
  const showingHistorical = amount !== null && (!hasRecord || point.amount === null);
  const quality = missing ? null : point.status === "expired"
    ? "过期"
    : point.status === "incomplete"
      ? point.amount === null && point.events?.length ? "暂无资产估值" : "不完整"
      : null;
  const formattedAmount = amount === null ? null : isSensitiveHidden ? "••••••" : formatAmount(amount);
  const prefix = showingHistorical ? `${point.historicalLabel} ` : undefined;

  return [
    { tag: "span", text: formatTrendTooltipDay(point.day) },
    { tag: "strong", text: missing ? "暂无记录" : formattedAmount === null
      ? "—"
      : `${prefix ?? ""}${formattedAmount}`,
      counter: formattedAmount === null || isSensitiveHidden ? undefined : { value: formattedAmount, prefix },
      unit: showCurrency && !missing ? currency : undefined },
    { tag: "small", text: [!missing && amount === null ? "未估值" : null, showingHistorical ? "早期记录" : null, quality].filter(Boolean).join("，") },
    ...fundingEventRows(point.events, formatAmount, isSensitiveHidden),
  ];
}

function fundingEventRows(
  events: AssetTrendEvent[] | undefined,
  formatAmount: (value: string) => string,
  isSensitiveHidden: boolean,
): TrendTooltipRow[] {
  return (events ?? []).flatMap(event => {
    const original = event.originalAmount ?? event;
    const sign = isSensitiveHidden || event.kind === "opening" ? "" : event.kind === "deposit" ? "+" : "-";
    const tone = isSensitiveHidden || event.kind === "opening" ? undefined : event.kind;
    const rows: TrendTooltipRow[] = [{
      tag: "small",
      text: `${event.kind === "opening" ? "期初本金" : event.kind === "deposit" ? "入金" : "出金"} ${sign}${isSensitiveHidden ? "••••••" : formatAmount(original.amount)}`,
      unit: original.currency,
      tone,
    }];
    if (event.originalAmount) rows.push({
      tag: "small",
      text: `折合 ${sign}${isSensitiveHidden ? "••••••" : formatAmount(event.amount)}`,
      unit: event.currency,
      tone,
    });
    return rows;
  });
}

function FundingEventMarker({ cx, cy, kinds }: {
  cx?: number;
  cy?: number;
  kinds: AssetTrendEvent["kind"][];
}) {
  if (cx === undefined || cy === undefined) return <g />;
  const deposit = kinds.includes("deposit");
  const withdrawal = kinds.includes("withdrawal");
  const radius = withdrawal ? deposit ? 6 : 4.5 : deposit ? 4 : 2.5;

  return (
    <g aria-hidden="true" pointerEvents="none">
      <circle cx={cx} cy={cy} fill="var(--surface)" r={radius + 2.5} />
      <circle
        cx={cx}
        cy={cy}
        fill={withdrawal ? "var(--surface)" : deposit ? "var(--display)" : "var(--secondary)"}
        r={radius}
        stroke={withdrawal ? "var(--display)" : "none"}
        strokeWidth={1.5}
      />
      {deposit && withdrawal ? <circle cx={cx} cy={cy} fill="var(--display)" r={3} /> : null}
    </g>
  );
}

function FundingEventLegend({ points }: { points: AssetTrendChartPoint[] }) {
  if (!points.some(point => point.events?.some(event => event.kind !== "opening"))) return null;

  return (
    <div aria-label="资金标记" className="asset-trend-event-legend">
      {(["deposit", "withdrawal"] as const).map(kind => (
        <span key={kind}>
          <svg aria-hidden="true" height={16} viewBox="0 0 20 20" width={16}>
            <FundingEventMarker cx={10} cy={10} kinds={[kind]} />
          </svg>
          {kind === "deposit" ? "入金" : "出金"}
        </span>
      ))}
    </div>
  );
}

function benchmarkTooltipReturnRow(label: string, value: number | null, isSensitiveHidden: boolean, series?: "spx" | "ndx"): TrendTooltipRow {
  const formattedValue = value === null ? null : isSensitiveHidden ? "••••••" : percentage(value, true).slice(0, -1);
  const prefix = `${label} `;
  return {
    tag: "strong",
    text: `${prefix}${formattedValue === null ? "数据不足" : `${formattedValue}${isSensitiveHidden ? "" : "%"}`}`,
    series,
    counter: formattedValue === null || isSensitiveHidden ? undefined : { value: formattedValue, prefix, suffix: "%" },
  };
}

function benchmarkTooltipRows(point: BenchmarkChartDatum, {
  assetScopeLabel,
  currency,
  enabledSymbols,
  formatAmount,
  isSensitiveHidden,
  returnComparison,
}: {
  assetScopeLabel: string;
  currency: string;
  enabledSymbols: MarketBenchmarkSymbol[];
  formatAmount(value: string): string;
  isSensitiveHidden: boolean;
  returnComparison?: boolean;
}): TrendTooltipRow[] {
  const missing = !hasTrendRecord(point) && (point.events?.length ?? 0) === 0;
  const assetsLabel = returnComparison ? `${assetScopeLabel}收益率` : assetLabel(assetScopeLabel);

  const rows: TrendTooltipRow[] = [
    { tag: "span", text: formatTrendTooltipDay(point.day) },
    missing ? { tag: "strong", text: `我的${assetsLabel} 暂无记录` } : benchmarkTooltipReturnRow(`我的${assetsLabel}`, point.assets, isSensitiveHidden),
  ];
  if (!returnComparison) {
    const formattedAmount = missing || point.amount === null ? null : isSensitiveHidden ? "••••••" : formatAmount(point.amount);
    rows.push({ tag: "small", text: missing ? "" : formattedAmount ?? "—", unit: missing ? undefined : currency,
      counter: formattedAmount === null || isSensitiveHidden ? undefined : { value: formattedAmount } });
    rows.push({ tag: "small", text: !missing && point.amount === null ? "资产金额未估值" : "" });
  }
  for (const symbol of enabledSymbols) rows.push(benchmarkTooltipReturnRow(
    marketBenchmarkLabel(symbol),
    point[symbol],
    isSensitiveHidden,
    symbol === ".SPX.US" ? "spx" : "ndx",
  ));
  rows.push(...fundingEventRows(point.events, formatAmount, isSensitiveHidden));
  return rows;
}

function TrendTooltip<Point,>({ active, payload, rowsForPoint, sizing }: TooltipContentProps & {
  rowsForPoint(point: Point): TrendTooltipRow[];
  sizing: string[][];
}) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || point === undefined) return null;
  return <TrendTooltipSurface rows={rowsForPoint(point)} sizing={sizing} />;
}

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
}: {
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
}) {
  const dotFillId = `asset-trend-dots-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const glowId = `${dotFillId}-glow`;

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
  const historicalObserved = data.filter((point) => point.historicalValue !== null).length;
  const eventPoints = data.filter(point => point.value !== null && (point.events?.length ?? 0) > 0);
  const today = data.at(-1);
  const amounts = data.flatMap((point) => [
    ...(point.amount === null ? [] : [point.amount]),
    ...(point.historicalAmount === null ? [] : [point.historicalAmount]),
  ]);
  const values = amounts.map(Number);
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
      aria-hidden={!benchmarkVisible && !benchmark.returnComparison}
      aria-label="已显示曲线"
      className="investment-performance__benchmark-series"
    >
      <span className="investment-performance__benchmark-series--assets">
        我的{benchmark.returnComparison ? `${benchmark.assetScopeLabel}收益率` : assetLabel(benchmark.assetScopeLabel)}
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
    const benchmarkEventPoints = benchmarkData.filter(point => point.assets !== null && (point.events?.length ?? 0) > 0);
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
    const tooltipRows = (point: BenchmarkChartDatum) => benchmarkTooltipRows(point, {
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
                  fontFamily: "var(--f-display)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
                tickFormatter={(value: number) => isSensitiveHidden ? "••••••" : percentage(value)}
                tickLine={false}
                width={56}
              />
              <TrendChartTooltip
                content={(props) => (
                  <TrendTooltip
                    {...props}
                    rowsForPoint={tooltipRows}
                    sizing={tooltipSizing}
                  />
                )}
              />
              <ReferenceLine stroke="var(--line-2)" strokeWidth={1} y={0} />
              {benchmarkEventPoints.map(point => (
                <ReferenceDot
                  key={`funding-event:${point.day}`}
                  shape={({ cx, cy }) => <FundingEventMarker cx={cx} cy={cy} kinds={point.events!.map(event => event.kind)} />}
                  x={point.day}
                  y={point.assets!}
                  zIndex={FUNDING_EVENT_Z_INDEX}
                />
              ))}
              {showDotFill ? <Area
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
              {benchmarkLastValueIndex >= 0 && !benchmarkData[benchmarkLastValueIndex].events?.length ? (
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
        </TrendChartSurface>
        <FundingEventLegend points={benchmarkEventPoints} />
      </div>
    );
  }

  if (values.length === 0) {
    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        <p className="trend-empty">{emptyMessage}</p>
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
  const axisValue = (value: number) => isSensitiveHidden ? "••••••" : currency === "%"
    ? `${formatAmount(String(value))}%`
    : formatAmount(String(value));
  const lastValueIndex = data.reduce(
    (lastIndex, point, index) => point.value === null ? lastIndex : index,
    -1,
  );
  const tooltipRows = (point: ChartDatum) => trendTooltipRows(point, { currency, formatAmount, isSensitiveHidden, showCurrency });
  const tooltipSizing = trendTooltipSizing(data.map(tooltipRows));

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
                fontFamily: "var(--f-display)",
                fontSize: 12,
                fontWeight: 500,
              }}
              tickFormatter={axisValue}
              tickLine={false}
              width={minimalPlot ? 0 : currency === "%" ? 56 : 84}
            />
            <TrendChartTooltip
              content={(props) => (
                <TrendTooltip
                  {...props}
                  rowsForPoint={tooltipRows}
                  sizing={tooltipSizing}
                />
              )}
            />
            {!minimalPlot && today?.amount != null ? (
              <ReferenceLine
                stroke="var(--secondary)"
                strokeWidth={1}
                x={today.day}
              />
            ) : null}
            {!minimalPlot ? eventPoints.map(point => (
              <ReferenceDot
                key={`funding-event:${point.day}`}
                shape={({ cx, cy }) => <FundingEventMarker cx={cx} cy={cy} kinds={point.events!.map(event => event.kind)} />}
                x={point.day}
                y={point.value!}
                zIndex={FUNDING_EVENT_Z_INDEX}
              />
            )) : null}
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
              animationDuration={TREND_CHART_ANIMATION_DURATION}
              animationEasing="ease-out"
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
              isSensitiveHidden={isSensitiveHidden}
              maximum={formatAmount(amounts[values.indexOf(maximum)])}
              minimum={formatAmount(amounts[values.indexOf(minimum)])}
            /> : null}
            {lastValueIndex >= 0 && (minimalPlot || !data[lastValueIndex].events?.length) ? (
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
      </TrendChartSurface>
      {!minimalPlot ? <FundingEventLegend points={eventPoints} /> : null}
    </div>
  );
}
