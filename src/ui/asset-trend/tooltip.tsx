import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Tooltip,
  useActiveTooltipCoordinate,
  usePlotArea,
  type TooltipContentProps,
} from "recharts";

import { marketBenchmarkLabel, type MarketBenchmarkSymbol } from "@/domain/market-benchmark";
import { formatShanghaiFullDayLabel } from "@/ui/shanghai-date-time";
import { VibeLiveCounter } from "@/ui/vibe/vibe-live-counter";

import {
  assetLabel,
  percentage,
  type AssetTrendChartPoint,
  type AssetTrendEvent,
  type BenchmarkChartDatum,
  type ChartDatum,
} from "./shared";

function formatTrendTooltipDay(day: string): string {
  // Keep number/CJK spacing explicit so later text spacing cannot change placement.
  return formatShanghaiFullDayLabel(day)
    .replace(/([年月日])/g, " $1 ")
    .trim();
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

export function trendTooltipSizing(points: TrendTooltipRow[][]): string[][] {
  const rows: Set<string>[] = [];
  for (const point of points) {
    point.forEach(({ text, unit }, index) => {
      rows[index] ??= new Set();
      // Tabular digits share a width; keep only distinct text shapes for sizing.
      if (text) rows[index].add(`${text}${unit ? ` ${unit}` : ""}`.replace(/[0-9]/g, "0"));
    });
  }
  return rows.map((row) => [...row]);
}

const TrendPointerContext = createContext<number | null>(null);

export function TrendChartSurface({ children }: { children: ReactNode }) {
  const [pointerX, setPointerX] = useState<number | null>(null);

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    setPointerX(((event.clientX - bounds.left) * event.currentTarget.clientWidth) / bounds.width);
  }

  return (
    <div
      className="total-trend-chart-wrap"
      onKeyDownCapture={() => setPointerX(null)}
      onPointerDown={trackPointer}
      onPointerLeave={() => setPointerX(null)}
      onPointerMove={trackPointer}
    >
      <TrendPointerContext value={pointerX}>{children}</TrendPointerContext>
    </div>
  );
}

function TrendChartCursor() {
  const pointerX = useContext(TrendPointerContext);
  const coordinate = useActiveTooltipCoordinate();
  const plotArea = usePlotArea();
  if (!plotArea || !coordinate) return null;
  const x = Math.max(plotArea.x, Math.min(pointerX ?? coordinate.x, plotArea.x + plotArea.width));

  return (
    <line
      className="recharts-tooltip-cursor"
      pointerEvents="none"
      stroke="var(--line-2)"
      strokeWidth={1}
      x1={x}
      x2={x}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
    />
  );
}

export function TrendChartTooltip(props: ComponentProps<typeof Tooltip>) {
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

function TrendTooltipSurface({ rows, sizing }: { rows: TrendTooltipRow[]; sizing: string[][] }) {
  return (
    <div className="asset-trend-tooltip">
      {rows.map(({ tag: Tag, text, unit, series, tone, counter }, index) => {
        const content = counter ? (
          <>
            {counter.prefix}
            <VibeLiveCounter animate={false} value={counter.value} />
            {counter.suffix}
          </>
        ) : (
          text
        );
        return sizing[index]?.length ? (
          <div className="asset-trend-tooltip-row" key={index}>
            {sizing[index].map((candidate) => (
              <Tag aria-hidden="true" className="asset-trend-tooltip-sizer" key={candidate}>
                {candidate}
              </Tag>
            ))}
            <Tag
              className={
                [
                  unit ? "asset-trend-tooltip-amount" : null,
                  series ? `asset-trend-tooltip-series--${series}` : null,
                  tone ? `asset-trend-tooltip-event--${tone}` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              {unit ? (
                <>
                  <span>{content}</span> <span>{unit}</span>
                </>
              ) : (
                content
              )}
            </Tag>
          </div>
        ) : null;
      })}
    </div>
  );
}

export function trendTooltipRows(
  point: ChartDatum,
  {
    currency,
    formatAmount,
    isSensitiveHidden,
    showCurrency,
  }: {
    currency: string;
    formatAmount(value: string): string;
    isSensitiveHidden: boolean;
    showCurrency: boolean;
  },
): TrendTooltipRow[] {
  const hasRecord = hasTrendRecord(point) || (point.events?.length ?? 0) > 0;
  const inferred = point.inferred === true;
  const amount = inferred
    ? point.amount
    : hasRecord
      ? (point.amount ?? point.historicalAmount)
      : point.historicalAmount;
  const missing = !inferred && !hasRecord && point.historicalAmount === null;
  const showingHistorical = !inferred && amount !== null && (!hasRecord || point.amount === null);
  const quality = inferred
    ? "按累计资金推算"
    : missing
    ? null
    : point.status === "expired"
      ? "过期"
      : point.status === "incomplete"
        ? point.amount === null && point.events?.length
          ? "暂无资产估值"
          : "不完整"
        : null;
  const formattedAmount =
    amount === null ? null : isSensitiveHidden ? "••••••" : formatAmount(amount);
  const prefix = showingHistorical ? `${point.historicalLabel} ` : undefined;

  return [
    { tag: "span", text: formatTrendTooltipDay(point.day) },
    {
      tag: "strong",
      text: inferred
        ? formattedAmount === null
          ? "暂无资产估值"
          : `推算 ${formattedAmount}`
        : missing
        ? "暂无记录"
        : formattedAmount === null
          ? "—"
          : `${prefix ?? ""}${formattedAmount}`,
      counter:
        formattedAmount === null || isSensitiveHidden
          ? undefined
          : { value: formattedAmount, prefix: inferred ? "推算 " : prefix },
      unit: showCurrency && !missing ? currency : undefined,
    },
    {
      tag: "small",
      text: [
        !inferred && !missing && amount === null ? "未估值" : null,
        showingHistorical ? "早期记录" : null,
        quality,
      ]
        .filter(Boolean)
        .join("，"),
    },
    ...fundingEventRows(point.events, formatAmount, isSensitiveHidden),
  ];
}

function fundingEventRows(
  events: AssetTrendEvent[] | undefined,
  formatAmount: (value: string) => string,
  isSensitiveHidden: boolean,
): TrendTooltipRow[] {
  return (events ?? []).flatMap((event) => {
    const original = event.originalAmount ?? event;
    const sign =
      isSensitiveHidden || event.kind === "opening" ? "" : event.kind === "deposit" ? "+" : "-";
    const tone = isSensitiveHidden || event.kind === "opening" ? undefined : event.kind;
    const rows: TrendTooltipRow[] = [
      {
        tag: "small",
        text: `${event.kind === "opening" ? "期初本金" : event.kind === "deposit" ? "入金" : "出金"} ${sign}${isSensitiveHidden ? "••••••" : formatAmount(original.amount)}`,
        unit: original.currency,
        tone,
      },
    ];
    if (event.originalAmount)
      rows.push({
        tag: "small",
        text: `折合 ${sign}${isSensitiveHidden ? "••••••" : formatAmount(event.amount)}`,
        unit: event.currency,
        tone,
      });
    return rows;
  });
}
function benchmarkTooltipReturnRow(
  label: string,
  value: number | null,
  isSensitiveHidden: boolean,
  series?: "spx" | "ndx",
): TrendTooltipRow {
  const formattedValue =
    value === null ? null : isSensitiveHidden ? "••••••" : percentage(value, true).slice(0, -1);
  const prefix = `${label} `;
  return {
    tag: "strong",
    text: `${prefix}${formattedValue === null ? "数据不足" : `${formattedValue}${isSensitiveHidden ? "" : "%"}`}`,
    series,
    counter:
      formattedValue === null || isSensitiveHidden
        ? undefined
        : { value: formattedValue, prefix, suffix: "%" },
  };
}

export function benchmarkTooltipRows(
  point: BenchmarkChartDatum,
  {
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
  },
): TrendTooltipRow[] {
  const missing = !hasTrendRecord(point) && (point.events?.length ?? 0) === 0;
  const assetsLabel = returnComparison ? `${assetScopeLabel}收益率` : assetLabel(assetScopeLabel);

  const rows: TrendTooltipRow[] = [
    { tag: "span", text: formatTrendTooltipDay(point.day) },
    missing
      ? { tag: "strong", text: `我的${assetsLabel} 暂无记录` }
      : benchmarkTooltipReturnRow(`我的${assetsLabel}`, point.assets, isSensitiveHidden),
  ];
  if (!returnComparison) {
    const formattedAmount =
      missing || point.amount === null
        ? null
        : isSensitiveHidden
          ? "••••••"
          : formatAmount(point.amount);
    rows.push({
      tag: "small",
      text: missing ? "" : (formattedAmount ?? "—"),
      unit: missing ? undefined : currency,
      counter:
        formattedAmount === null || isSensitiveHidden ? undefined : { value: formattedAmount },
    });
    rows.push({ tag: "small", text: !missing && point.amount === null ? "资产金额未估值" : "" });
  }
  for (const symbol of enabledSymbols)
    rows.push(
      benchmarkTooltipReturnRow(
        marketBenchmarkLabel(symbol),
        point[symbol],
        isSensitiveHidden,
        symbol === ".SPX.US" ? "spx" : "ndx",
      ),
    );
  rows.push(...fundingEventRows(point.events, formatAmount, isSensitiveHidden));
  return rows;
}

export function TrendTooltip<Point>({
  active,
  payload,
  rowsForPoint,
  sizing,
}: TooltipContentProps & {
  rowsForPoint(point: Point): TrendTooltipRow[];
  sizing: string[][];
}) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || point === undefined) return null;
  return <TrendTooltipSurface rows={rowsForPoint(point)} sizing={sizing} />;
}
