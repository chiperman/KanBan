"use client";

import { useEffect, useMemo, useState } from "react";

import type { LongbridgeHoldingCandlePeriod } from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

interface Candlestick {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

interface TrendPoint {
  time: string;
  price: string;
}

interface CandlestickResponse {
  symbol?: string;
  period?: LongbridgeHoldingCandlePeriod;
  candles?: Candlestick[];
  trend?: TrendPoint[];
  error?: string;
}

const PERIODS: ReadonlyArray<{
  value: LongbridgeHoldingCandlePeriod;
  label: string;
  description: string;
}> = [
  { value: "five-day", label: "5日", description: "近五个交易日走势（5分钟）" },
  { value: "day", label: "日K", description: "日K" },
  { value: "week", label: "周K", description: "周K" },
  { value: "month", label: "月K", description: "月K" },
  { value: "year", label: "年K", description: "年K" },
  { value: "min-1", label: "1分", description: "1分钟K线" },
];

function numberValue(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCandleTime(time: string, period: LongbridgeHoldingCandlePeriod): string {
  const parsed = new Date(time);
  if (Number.isNaN(parsed.getTime())) return time;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    ...(period === "min-1"
      ? { hour: "2-digit" as const, minute: "2-digit" as const, hourCycle: "h23" as const }
      : {}),
  }).format(parsed);
}

function marketTimeZone(symbol: string): string {
  switch (symbol.split(".").at(-1)?.toUpperCase()) {
    case "US": return "America/New_York";
    case "HK": return "Asia/Hong_Kong";
    case "SG": return "Asia/Singapore";
    case "SH":
    case "SZ": return "Asia/Shanghai";
    default: return "Asia/Shanghai";
  }
}

function formatTrendTime(time: string, symbol: string): string {
  const parsed = new Date(time);
  if (Number.isNaN(parsed.getTime())) return time;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: marketTimeZone(symbol),
    month: "numeric",
    day: "numeric",
  }).format(parsed);
}

function validCandles(candles: Candlestick[]): Candlestick[] {
  return candles.filter((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
  ].every((value) => numberValue(value) !== null));
}

function validTrend(points: TrendPoint[]): TrendPoint[] {
  return points.filter((point) =>
    !Number.isNaN(new Date(point.time).getTime()) && numberValue(point.price) !== null,
  );
}

function HoldingCandlestickSvg({
  candles,
  period,
  symbol,
}: {
  candles: Candlestick[];
  period: LongbridgeHoldingCandlePeriod;
  symbol: string;
}) {
  const geometry = useMemo(() => {
    const parsed = candles.map((candle) => ({
      candle,
      open: numberValue(candle.open)!,
      high: numberValue(candle.high)!,
      low: numberValue(candle.low)!,
      close: numberValue(candle.close)!,
    }));
    const highest = Math.max(...parsed.map((candle) => candle.high));
    const lowest = Math.min(...parsed.map((candle) => candle.low));
    const padding = Math.max((highest - lowest) * 0.08, highest * 0.002, 0.01);
    const upper = highest + padding;
    const lower = lowest - padding;
    const width = 760;
    const height = 320;
    const plot = { left: 8, top: 20, right: 66, bottom: 42 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const spread = upper - lower || 1;
    const y = (value: number) => plot.top + ((upper - value) / spread) * plotHeight;
    const step = parsed.length === 1 ? plotWidth / 2 : plotWidth / (parsed.length - 1);
    const bodyWidth = Math.max(4, Math.min(18, step * 0.62));
    return { bodyWidth, height, lower, parsed, plot, plotHeight, plotWidth, step, upper, width, y };
  }, [candles]);

  const labels = [0, 0.5, 1].map((position) => {
    const value = geometry.upper - (geometry.upper - geometry.lower) * position;
    return { value, y: geometry.y(value) };
  });
  const candleLabels = [
    geometry.parsed[0],
    geometry.parsed[Math.floor((geometry.parsed.length - 1) / 2)],
    geometry.parsed.at(-1),
  ]
    .flatMap((entry) => entry === undefined ? [] : [entry])
    .filter((entry, index, list) => list.indexOf(entry) === index);

  return (
    <svg
      aria-label={`${symbol} ${PERIODS.find((item) => item.value === period)?.description ?? "K线"}`}
      className="holding-candlestick-chart__svg"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
    >
      <g aria-hidden="true" className="holding-candlestick-chart__grid">
        {labels.map((label) => (
          <g key={label.y}>
            <line
              x1={geometry.plot.left}
              x2={geometry.width - geometry.plot.right}
              y1={label.y}
              y2={label.y}
            />
            <text x={geometry.width - geometry.plot.right + 8} y={label.y + 4}>
              {formatPrice(label.value)}
            </text>
          </g>
        ))}
      </g>
      <g className="holding-candlestick-chart__candles">
        {geometry.parsed.map((entry, index) => {
          const x = geometry.plot.left + index * geometry.step;
          const rising = entry.close >= entry.open;
          const top = geometry.y(Math.max(entry.open, entry.close));
          const bottom = geometry.y(Math.min(entry.open, entry.close));
          return (
            <g
              className={`holding-candlestick-chart__candle holding-candlestick-chart__candle--${rising ? "up" : "down"}`}
              data-testid="holding-candlestick"
              key={`${entry.candle.time}-${index}`}
            >
              <line x1={x} x2={x} y1={geometry.y(entry.high)} y2={geometry.y(entry.low)} />
              <rect
                height={Math.max(1.5, bottom - top)}
                width={geometry.bodyWidth}
                x={x - geometry.bodyWidth / 2}
                y={top}
              />
            </g>
          );
        })}
      </g>
      <g aria-hidden="true" className="holding-candlestick-chart__axis">
        {candleLabels.map((entry, index) => {
          const candleIndex = geometry.parsed.indexOf(entry);
          const x = geometry.plot.left + candleIndex * geometry.step;
          return (
            <text
              key={`${entry.candle.time}-${index}`}
              textAnchor={index === 0 ? "start" : index === candleLabels.length - 1 ? "end" : "middle"}
              x={x}
              y={geometry.height - 14}
            >
              {formatCandleTime(entry.candle.time, period)}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

function HoldingTrendSvg({
  symbol,
  trend,
}: {
  symbol: string;
  trend: TrendPoint[];
}) {
  const geometry = useMemo(() => {
    const parsed = trend.map((point) => ({ point, price: numberValue(point.price)! }));
    const highest = Math.max(...parsed.map((point) => point.price));
    const lowest = Math.min(...parsed.map((point) => point.price));
    const padding = Math.max((highest - lowest) * 0.08, highest * 0.002, 0.01);
    const upper = highest + padding;
    const lower = lowest - padding;
    const width = 760;
    const height = 320;
    const plot = { left: 8, top: 20, right: 66, bottom: 42 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const spread = upper - lower || 1;
    const y = (value: number) => plot.top + ((upper - value) / spread) * plotHeight;
    const step = parsed.length === 1 ? plotWidth / 2 : plotWidth / (parsed.length - 1);
    return { height, lower, parsed, plot, step, upper, width, y };
  }, [trend]);

  const labels = [0, 0.5, 1].map((position) => {
    const value = geometry.upper - (geometry.upper - geometry.lower) * position;
    return { value, y: geometry.y(value) };
  });
  const timeLabels = [
    geometry.parsed[0],
    geometry.parsed[Math.floor((geometry.parsed.length - 1) / 2)],
    geometry.parsed.at(-1),
  ]
    .flatMap((entry) => entry === undefined ? [] : [entry])
    .filter((entry, index, list) => list.indexOf(entry) === index);
  const points = geometry.parsed.map((entry, index) =>
    `${geometry.plot.left + index * geometry.step},${geometry.y(entry.price)}`,
  ).join(" ");

  return (
    <svg
      aria-label={`${symbol} 近五个交易日走势（5分钟）`}
      className="holding-candlestick-chart__svg"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
    >
      <g aria-hidden="true" className="holding-candlestick-chart__grid">
        {labels.map((label) => (
          <g key={label.y}>
            <line
              x1={geometry.plot.left}
              x2={geometry.width - geometry.plot.right}
              y1={label.y}
              y2={label.y}
            />
            <text x={geometry.width - geometry.plot.right + 8} y={label.y + 4}>
              {formatPrice(label.value)}
            </text>
          </g>
        ))}
      </g>
      <polyline
        className="holding-candlestick-chart__trend"
        data-testid="holding-trend-line"
        points={points}
      />
      <g aria-hidden="true" className="holding-candlestick-chart__axis">
        {timeLabels.map((entry, index) => {
          const pointIndex = geometry.parsed.indexOf(entry);
          const x = geometry.plot.left + pointIndex * geometry.step;
          return (
            <text
              key={`${entry.point.time}-${index}`}
              textAnchor={index === 0 ? "start" : index === timeLabels.length - 1 ? "end" : "middle"}
              x={x}
              y={geometry.height - 14}
            >
              {formatTrendTime(entry.point.time, symbol)}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

export function HoldingCandlestickChart({
  name,
  onClose,
  sourceId,
  symbol,
}: {
  name: string;
  onClose(): void;
  sourceId: string;
  symbol: string;
}) {
  const [period, setPeriod] = useState<LongbridgeHoldingCandlePeriod>("day");
  const [candles, setCandles] = useState<Candlestick[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setCandles([]);
    setTrend([]);
    setError(null);
    setLoading(true);

    async function load() {
      try {
        const response = await fetch(
          `/api/asset-sources/${encodeURIComponent(sourceId)}/candles?symbol=${encodeURIComponent(symbol)}&period=${period}`,
          { signal: controller.signal },
        );
        const result = await readJsonResult<CandlestickResponse>(response);
        // 会话失效时立即广播锁定，K 线不再显示普通读取错误。
        if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        if (!response.ok || result === null) {
          throw new Error(result?.error ?? "长桥 K 线读取失败");
        }
        if (period === "five-day") {
          const nextTrend = validTrend(result.trend ?? []);
          if (nextTrend.length < 2) {
            throw new Error("长桥暂未返回可展示的近五日走势");
          }
          setTrend(nextTrend);
        } else {
          const nextCandles = validCandles(result.candles ?? []);
          if (nextCandles.length === 0) {
            throw new Error("长桥暂未返回可展示的 K 线数据");
          }
          setCandles(nextCandles);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "长桥 K 线读取失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [period, sourceId, symbol]);

  const currentPeriod = PERIODS.find((item) => item.value === period)!;
  return (
    <VibeDialog
      actions={
        <VibeButton onClick={onClose} type="button" variant="text">
          关闭
        </VibeButton>
      }
      aria-label={`查看 ${name} K线`}
      className="holding-candlestick-dialog"
      description={`常规盘 · 未复权 · ${currentPeriod.description}`}
      eyebrow="LONGBRIDGE / CANDLESTICK"
      onClose={onClose}
      title={`${name} K线`}
      titleId="holding-candlestick-chart-title"
    >
      <div className="holding-candlestick-chart" data-testid="holding-candlestick-chart">
        <div aria-label="K线周期" className="holding-candlestick-chart__periods" role="group">
          {PERIODS.map((item) => (
            <VibeButton
              aria-pressed={period === item.value}
              className="holding-candlestick-chart__period"
              data-candle-period={item.value}
              key={item.value}
              onClick={() => setPeriod(item.value)}
              type="button"
              variant="text"
            >
              {item.label}
            </VibeButton>
          ))}
        </div>
        {loading ? (
          <p className="holding-candlestick-chart__status" role="status">
            {period === "five-day" ? "正在读取走势…" : "正在读取 K 线…"}
          </p>
        ) : null}
        {!loading && error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
        {!loading && error === null && period === "five-day" && trend.length > 1 ? (
          <HoldingTrendSvg symbol={symbol} trend={trend} />
        ) : null}
        {!loading && error === null && period !== "five-day" && candles.length > 0 ? (
          <HoldingCandlestickSvg candles={candles} period={period} symbol={symbol} />
        ) : null}
      </div>
    </VibeDialog>
  );
}
