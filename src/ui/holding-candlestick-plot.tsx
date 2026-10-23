"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { longbridgeQuoteSession, longbridgeQuoteTime, type LongbridgeRealtimeQuote } from "@/domain/longbridge-realtime";
import type { LongbridgeHoldingCandlePeriod, LongbridgeHoldingCandlestick, LongbridgeHoldingTrendPoint } from "@/server/ports";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { holdingMarketTimeZone } from "@/ui/holding-candlestick-live";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeIcon } from "@/ui/vibe/vibe-icon";

const priceFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });
const percentFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const volumeFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function HoldingCandlestickPlot({ candles, currency, period, profitColorScheme, realtimeQuote, symbol, trend }: {
  candles: LongbridgeHoldingCandlestick[];
  currency: string;
  period: LongbridgeHoldingCandlePeriod;
  profitColorScheme: ProfitColorScheme;
  realtimeQuote?: LongbridgeRealtimeQuote;
  symbol: string;
  trend: LongbridgeHoldingTrendPoint[];
}) {
  const isTrend = period === "five-day";
  const series = useMemo(() => isTrend
    ? trend.map((point) => ({ time: point.time, close: Number(point.price), open: null, high: Number(point.price), low: Number(point.price), volume: null }))
    : candles.map((candle) => ({
      time: candle.time, close: Number(candle.close), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low),
      volume: candle.volume.trim() !== "" && Number.isFinite(Number(candle.volume)) && Number(candle.volume) >= 0 ? Number(candle.volume) : null,
    })), [candles, isTrend, trend]);
  const total = series.length;
  const defaultCount = isTrend ? total : Math.min(80, total);
  const [windowRange, setWindowRange] = useState<{ count: number | null; endTime: string | null }>({ count: isTrend ? null : defaultCount, endTime: null });
  const count = windowRange.count === null ? total : clamp(windowRange.count, Math.min(10, total), total);
  const anchoredEnd = windowRange.endTime === null ? total : series.findIndex((entry) => Date.parse(entry.time) > Date.parse(windowRange.endTime!));
  const end = clamp(anchoredEnd < 0 ? total : anchoredEnd, count, total);
  const start = end - count;
  const visible = useMemo(() => series.slice(start, end), [series, start, end]);
  const [selection, setSelection] = useState<{ time: string; x: number | null; y: number | null } | null>(null);
  const selectedIndex = selection ? clamp(series.findIndex((entry) => entry.time === selection.time), start, end - 1) : end - 1;
  const selected = series[selectedIndex];
  const quoteTime = longbridgeQuoteTime(realtimeQuote?.timestamp);
  // 主报价始终跟随持仓；历史选点只改变下方读数。
  const showQuote = realtimeQuote !== undefined && quoteTime !== null && quoteTime >= Date.parse(series.at(-1)!.time);
  const quotedPrice = showQuote ? Number(realtimeQuote.last_done) : null;
  const latest = series.at(-1)!;
  const displayPrice = quotedPrice ?? latest.close;
  const guidePrice = end === total ? displayPrice : visible.at(-1)!.close;
  const quoteSession = longbridgeQuoteSession(realtimeQuote?.trade_session);
  const sessionLabel = { regular: "常规盘", "pre-market": "盘前", "post-market": "盘后", overnight: "隔夜", unknown: "时段未知", "crypto-24h": "全天" };
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; count: number; end: number; anchor: number } | null>(null);
  const drag = useRef<{ x: number; end: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 340 });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => wheelHandler.current(event);
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, []);

  const timeFormat = useMemo(() => {
    const timeZone = holdingMarketTimeZone(symbol);
    const intraday = isTrend || period === "min-1";
    return {
      day: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
      full: new Intl.DateTimeFormat("zh-CN", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        ...(intraday ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const : {}),
      }),
      quote: new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }),
      axis: new Intl.DateTimeFormat("zh-CN", {
        timeZone,
        ...(period === "year" ? { year: "numeric" } as const
          : period === "month" ? { year: "2-digit", month: "2-digit" } as const
            : period === "min-1" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const
              : { month: "numeric", day: "numeric" } as const),
      }),
    };
  }, [isTrend, period, symbol]);

  const geometry = useMemo(() => {
    const highest = Math.max(...visible.map((entry) => entry.high), guidePrice);
    const lowest = Math.min(...visible.map((entry) => entry.low), guidePrice);
    const padding = Math.max((highest - lowest) * 0.1, Math.abs(highest) * 0.002, 0.0001);
    const rawStep = (highest - lowest + padding * 2) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const priceStep = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= rawStep)! * magnitude;
    const upper = Math.ceil((highest + padding) / priceStep) * priceStep;
    const lower = Math.floor((lowest - padding) / priceStep) * priceStep;
    const ticks = Array.from({ length: Math.round((upper - lower) / priceStep) + 1 }, (_, i) => upper - priceStep * i);
    const right = Math.max(76, ...ticks.map((value) => priceFormat.format(value).length * 8 + 16));
    const left = 4;
    const top = 16;
    const width = Math.max(1, size.width - left - right);
    const volumeHeight = isTrend ? 0 : 52;
    const bottom = size.height - 32;
    const priceBottom = bottom - volumeHeight - (isTrend ? 0 : 24);
    const step = width / count;
    const y = (value: number) => top + (upper - value) / (upper - lower) * (priceBottom - top);
    const x = (index: number) => left + (index + 0.5) * step;
    const maxVolume = Math.max(1, ...visible.map((entry) => entry.volume ?? 0));
    return { left, top, width, bottom, priceBottom, volumeHeight, step, ticks, upper, lower, x, y, maxVolume };
  }, [visible, count, isTrend, size, guidePrice]);

  // 按交易所交易日分组；五日图每个实际交易日都有日期和分隔线。
  const days = useMemo(() => {
    const groups: { day: string; first: number; last: number }[] = [];
    visible.forEach((entry, index) => {
      const day = timeFormat.day.format(new Date(entry.time));
      const last = groups.at(-1);
      if (last?.day === day) last.last = index;
      else groups.push({ day, first: index, last: index });
    });
    return groups;
  }, [visible, timeFormat]);

  function setView(nextCount: number, nextEnd: number) {
    setWindowRange({ count: nextCount === total ? null : nextCount, endTime: nextEnd === total ? null : series[nextEnd - 1].time });
  }

  function zoom(factor: number, anchor = 1) {
    const nextCount = clamp(Math.round(count * factor), Math.min(10, total), total);
    const nextEnd = clamp(Math.round(end + (nextCount - count) * (1 - anchor)), nextCount, total);
    setView(nextCount, nextEnd);
    setSelection(null);
  }

  function resetView() {
    setView(defaultCount, total);
    setSelection(null);
  }

  wheelHandler.current = (event) => {
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
      setView(count, clamp(end + Math.round(event.deltaX / geometry.step), count, total));
      setSelection(null);
      return;
    }
    const rect = svgRef.current!.getBoundingClientRect();
    const anchor = clamp((event.clientX - rect.left - geometry.left) / geometry.width, 0, 1);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    zoom(Math.exp(clamp(delta * (event.ctrlKey ? 0.015 : 0.003), -0.7, 0.7)), anchor);
  };

  function selectAt(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * size.width / rect.width;
    const y = (event.clientY - rect.top) * size.height / rect.height;
    const index = start + clamp(Math.floor((x - geometry.left) / geometry.step), 0, count - 1);
    setSelection({ time: series[index].time, x: clamp(x, geometry.left, geometry.left + geometry.width), y: y <= geometry.priceBottom ? clamp(y, geometry.top, geometry.priceBottom) : null });
  }

  const reference = showQuote ? Number(realtimeQuote.prev_close ?? NaN) : isTrend ? series[0].close : latest.open!;
  const change = !Number.isFinite(reference) || reference === 0 ? null : (displayPrice - reference) / reference * 100;
  const direction = change === null || change === 0 ? "neutral" : change > 0 ? "positive" : "negative";
  const crossX = selection?.x ?? geometry.x(selectedIndex - start);
  const crossY = selection?.y ?? geometry.y(selected.close);
  const crossPrice = geometry.upper - (crossY - geometry.top) / (geometry.priceBottom - geometry.top) * (geometry.upper - geometry.lower);
  const dateTickCount = Math.min(count, clamp(Math.floor(geometry.width / 110) + 1, 2, 8));
  const dateIndices = Array.from({ length: dateTickCount }, (_, index) => Math.round(index * (count - 1) / Math.max(1, dateTickCount - 1)));

  return (
    <div className="holding-candlestick-plot" data-profit-color-scheme={profitColorScheme}>
      <div className="holding-candlestick-chart__readout">
        <div className="holding-candlestick-chart__quote">
          <span className="holding-candlestick-chart__price"><AssetFinancialValue unit={currency}>{priceFormat.format(displayPrice)}</AssetFinancialValue></span>
          <span className="holding-candlestick-chart__change profit-color-value" data-profit-color-scheme={profitColorScheme} data-profit-direction={direction}>
            <span>{showQuote ? quoteSession === "regular" ? "较昨收" : "较常规盘收盘" : isTrend ? "较首点" : "开收涨跌"}</span>
            <AssetFinancialValue>{change === null ? "—" : `${change > 0 ? "+" : ""}${percentFormat.format(change)}%`}</AssetFinancialValue>
          </span>
        </div>
        <time className="holding-candlestick-chart__time" dateTime={showQuote ? new Date(quoteTime).toISOString() : latest.time}>{showQuote ? `${sessionLabel[quoteSession]} ${timeFormat.quote.format(quoteTime)}` : `最近K线 ${timeFormat.full.format(new Date(latest.time))}`}</time>
        <div className="holding-candlestick-chart__inspection">
        <time dateTime={selected.time}>{timeFormat.full.format(new Date(selected.time))}</time>
        {!isTrend ? (
          <dl aria-label="常规盘开高低收和成交量" className="holding-candlestick-chart__ohlc" title="当前K线随已收到的报价更新；未取得当前周期成交量时显示 —，跨周期后补齐历史数据">
            {[["开", priceFormat.format(selected.open!)], ["高", priceFormat.format(selected.high)], ["低", priceFormat.format(selected.low)], ["收", priceFormat.format(selected.close)], ["成交量", selected.volume === null ? "—" : volumeFormat.format(selected.volume)]].map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd><AssetFinancialValue>{value}</AssetFinancialValue></dd></div>
            ))}
          </dl>
        ) : <span><AssetFinancialValue>{priceFormat.format(selected.close)}</AssetFinancialValue></span>}
        </div>
      </div>
      <div className="holding-candlestick-chart__frame" ref={frameRef}>
        <svg
          aria-label={`${symbol} ${isTrend ? "近五日走势" : "K线与成交量"}`}
          aria-describedby="holding-candlestick-chart-help"
          className="holding-candlestick-chart__svg"
          ref={svgRef}
          onBlur={() => setSelection(null)}
          onDoubleClick={resetView}
          onKeyDown={(event) => {
            if (["+", "=", "-", "0"].includes(event.key)) {
              event.preventDefault();
              if (event.key === "0") resetView();
              else zoom(event.key === "-" ? 1.5 : 1 / 1.5);
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = event.key === "Home" ? 0 : event.key === "End" ? total - 1 : clamp(selectedIndex + (event.key === "ArrowLeft" ? -1 : 1), 0, total - 1);
            if (index < start) setView(count, index + count);
            if (index >= end) setView(count, index + 1);
            setSelection({ time: series[index].time, x: null, y: null });
          }}
          onPointerCancel={() => { pointers.current.clear(); pinch.current = null; drag.current = null; setSelection(null); }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const rect = event.currentTarget.getBoundingClientRect();
              pinch.current = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), count, end, anchor: clamp(((a.x + b.x) / 2 - rect.left - geometry.left) / geometry.width, 0, 1) };
              drag.current = null;
              setSelection(null);
              return;
            }
            drag.current = { x: event.clientX, end, moved: false };
            selectAt(event);
          }}
          onPointerLeave={() => { if (!drag.current) setSelection(null); }}
          onPointerMove={(event) => {
            if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pinch.current && pointers.current.size >= 2) {
              const [a, b] = [...pointers.current.values()];
              const initial = pinch.current;
              const nextCount = clamp(Math.round(initial.count * initial.distance / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))), Math.min(10, total), total);
              setView(nextCount, clamp(Math.round(initial.end + (nextCount - initial.count) * (1 - initial.anchor)), nextCount, total));
              return;
            }
            const active = drag.current;
            if (active && Math.abs(event.clientX - active.x) > 4) {
              active.moved = true;
              const offset = Math.round((event.clientX - active.x) / geometry.step);
              setView(count, clamp(active.end - offset, count, total));
              setSelection(null);
            } else if (!active?.moved) selectAt(event);
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId);
            if (pinch.current) {
              pinch.current = null;
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              return;
            }
            if (!drag.current) return;
            if (!drag.current.moved) selectAt(event);
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="group"
          tabIndex={0}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <title>滚轮或双指缩放，拖动查看历史，双击重置视图</title>
          <g aria-hidden="true" className="holding-candlestick-chart__grid">
            {geometry.ticks.map((value, index) => <g key={index}><line x1={geometry.left} x2={geometry.left + geometry.width} y1={geometry.y(value)} y2={geometry.y(value)} /><text x={geometry.left + geometry.width + 10} y={geometry.y(value) + 4}>{priceFormat.format(value)}</text></g>)}
          </g>
          {isTrend ? <>
            <g aria-hidden="true" className="holding-candlestick-chart__day-dividers">
              {days.slice(1).map((day) => <line key={day.day} x1={geometry.x(day.first) - geometry.step / 2} x2={geometry.x(day.first) - geometry.step / 2} y1={geometry.top} y2={geometry.bottom} />)}
            </g>
            {days.map((day) => <path key={day.day} className="holding-candlestick-chart__trend" d={visible.slice(day.first, day.last + 1).map((entry, index) => `${index === 0 ? "M" : "L"}${geometry.x(day.first + index)},${geometry.y(entry.close)}`).join(" ")} />)}
          </> : visible.map((entry, index) => {
            const rising = entry.close >= entry.open!;
            const bodyWidth = Math.max(1, Math.min(14, geometry.step * 0.66));
            const top = geometry.y(Math.max(entry.open!, entry.close));
            const bottom = geometry.y(Math.min(entry.open!, entry.close));
            const volumeHeight = entry.volume === null ? 0 : entry.volume / geometry.maxVolume * geometry.volumeHeight;
            return <g className={`holding-candlestick-chart__candle holding-candlestick-chart__candle--${rising ? "up" : "down"}`} data-testid="holding-candlestick" key={entry.time}>
              <line x1={geometry.x(index)} x2={geometry.x(index)} y1={geometry.y(entry.high)} y2={geometry.y(entry.low)} />
              <rect height={Math.max(1, bottom - top)} width={bodyWidth} x={geometry.x(index) - bodyWidth / 2} y={top} />
              {entry.volume !== null ? <rect className="holding-candlestick-chart__volume" height={volumeHeight} width={bodyWidth} x={geometry.x(index) - bodyWidth / 2} y={geometry.bottom - volumeHeight} /> : null}
            </g>;
          })}
          {!isTrend ? <g aria-hidden="true" className="holding-candlestick-chart__axis"><line x1={geometry.left} x2={geometry.left + geometry.width} y1={geometry.priceBottom + 16} y2={geometry.priceBottom + 16} /><text x={geometry.left + geometry.width + 10} y={geometry.priceBottom + 36}>成交量</text></g> : null}
          <g aria-hidden="true" className="holding-candlestick-chart__axis">
            {isTrend ? days.map((day) => <text key={day.day} textAnchor="middle" x={geometry.x((day.first + day.last) / 2)} y={size.height - 8}>{timeFormat.axis.format(new Date(visible[day.first].time))}</text>)
              : dateIndices.map((index, position) => <text key={index} textAnchor={position === 0 ? "start" : position === dateIndices.length - 1 ? "end" : "middle"} x={geometry.x(index)} y={size.height - 8}>{timeFormat.axis.format(new Date(visible[index].time))}</text>)}
          </g>
          <g aria-hidden="true" className="holding-candlestick-chart__last-price"><line x1={geometry.left} x2={geometry.left + geometry.width} y1={geometry.y(guidePrice)} y2={geometry.y(guidePrice)} /></g>
          {selection ? <g aria-hidden="true" className="holding-candlestick-chart__crosshair">
            <line x1={crossX} x2={crossX} y1={geometry.top} y2={geometry.bottom} /><line x1={geometry.left} x2={geometry.left + geometry.width} y1={crossY} y2={crossY} />
            <circle cx={crossX} cy={geometry.y(selected.close)} r={3} />
            <rect x={geometry.left + geometry.width + 2} y={crossY - 10} width={size.width - geometry.left - geometry.width - 4} height={20} rx={2} />
            <text x={geometry.left + geometry.width + 8} y={crossY + 4}>{priceFormat.format(crossPrice)}</text>
          </g> : null}
        </svg>
      </div>
      {end < total ? <div className="holding-candlestick-chart__return"><VibeButton onClick={() => { setView(count, total); setSelection(null); }} size="compact" type="button"><VibeIcon name="arrow-right" />回到最新</VibeButton></div> : null}
      <p hidden id="holding-candlestick-chart-help">悬停或轻触查看历史读数，主报价始终显示最新价。滚轮或双指缩放，拖动平移，双击重置。左右键逐根查看，加减键缩放，0 重置，Home 查看最早记录，End 返回最新。</p>
    </div>
  );
}
