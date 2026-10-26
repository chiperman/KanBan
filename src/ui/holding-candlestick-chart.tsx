"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { longbridgeQuoteSession, longbridgeQuoteTime, type LongbridgeRealtimeQuote } from "@/domain/longbridge-realtime";
import type { LongbridgeHoldingCandlePeriod, LongbridgeHoldingCandlestick, LongbridgeHoldingTrendPoint } from "@/server/ports";
import { applyHoldingChartQuote, holdingCandleBucket, holdingChartQuote, type HoldingChartData } from "@/ui/holding-candlestick-live";
import { HoldingCandlestickPlot } from "@/ui/holding-candlestick-plot";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";
import type { LongbridgeRealtimeState } from "@/ui/use-longbridge-realtime";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

interface CandlestickResponse {
  candles?: LongbridgeHoldingCandlestick[];
  trend?: LongbridgeHoldingTrendPoint[];
  error?: string;
}

const PERIODS: ReadonlyArray<{ value: LongbridgeHoldingCandlePeriod; label: string }> = [
  { value: "five-day", label: "5日" },
  { value: "day", label: "日K" },
  { value: "week", label: "周K" },
  { value: "month", label: "月K" },
  { value: "year", label: "年K" },
  { value: "min-1", label: "1分" },
];

type LoadedData = HoldingChartData;

function validNumber(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

/** 只在本次弹窗内缓存和合并请求；切换周期不取消仍可复用的读取。 */
function createChartSession(sourceId: string, symbol: string) {
  let locked = false;
  let latestQuote: LongbridgeRealtimeQuote | null = null;
  const cache = new Map<LongbridgeHoldingCandlePeriod, LoadedData>();
  const requests = new Map<LongbridgeHoldingCandlePeriod, { controller: AbortController; promise: Promise<LoadedData> }>();
  const READ_TIMEOUT_MS = 15_000;
  function clear() {
    requests.forEach(({ controller }) => controller.abort());
    requests.clear();
    cache.clear();
    latestQuote = null;
  }
  function receiveQuote(quote: LongbridgeRealtimeQuote) {
    if (locked || quote === latestQuote || quote.symbol !== symbol || (longbridgeQuoteTime(quote.timestamp) ?? 0) < (longbridgeQuoteTime(latestQuote?.timestamp) ?? 0)) return;
    latestQuote = quote;
    cache.forEach((data, period) => cache.set(period, applyHoldingChartQuote(data, period, quote)));
  }
  function invalidate() {
    cache.forEach((data, period) => cache.set(period, { ...data, receivedAt: 0 }));
  }
  function read(period: LongbridgeHoldingCandlePeriod, fresh = false): Promise<LoadedData> {
    if (locked) return Promise.reject(new Error(OWNER_SESSION_EXPIRED_MESSAGE));
    const cached = cache.get(period);
    if (!fresh && cached && Date.now() - cached.receivedAt < 60_000) return Promise.resolve(cached);
    const pending = requests.get(period);
    if (pending) return pending.promise;
    const controller = new AbortController();
    // 以请求前的报价为水位；延迟行情不能与电脑当前时间比较。
    const quoteAtRequest = longbridgeQuoteTime(latestQuote?.timestamp) ?? 0;
    const promise = (async () => {
      const timeout = setTimeout(() => controller.abort(new Error("长桥 K 线读取超时，请重试。")), READ_TIMEOUT_MS);
      try {
        const response = await fetch(
          `/api/asset-sources/${encodeURIComponent(sourceId)}/candles?symbol=${encodeURIComponent(symbol)}&period=${period}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await readJsonResult<CandlestickResponse>(response);
        controller.signal.throwIfAborted();
        if (lockOnUnauthorizedResponse(response)) {
          locked = true;
          clear();
          throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        }
        if (!response.ok || result === null) throw new Error(result?.error ?? "长桥 K 线读取失败");
        const candles = (result.candles ?? []).filter((candle) =>
          Number.isFinite(Date.parse(candle.time)) &&
          [candle.open, candle.high, candle.low, candle.close].every(validNumber),
        ).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        const trend = (result.trend ?? []).filter((point) =>
          Number.isFinite(Date.parse(point.time)) && validNumber(point.price),
        ).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        if (period === "five-day" ? trend.length < 2 : candles.length === 0) {
          throw new Error(period === "five-day" ? "长桥暂未返回可展示的近五日走势" : "长桥暂未返回可展示的 K 线数据");
        }
        const history = { candles, trend, receivedAt: Date.now(), quoteAt: quoteAtRequest };
        const data = latestQuote && (longbridgeQuoteTime(latestQuote.timestamp) ?? 0) > quoteAtRequest
          ? applyHoldingChartQuote(history, period, latestQuote) : history;
        cache.set(period, data);
        return data;
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => {
      if (requests.get(period)?.controller === controller) requests.delete(period);
    });
    requests.set(period, { controller, promise });
    return promise;
  }
  return { cache, clear, invalidate, read, receiveQuote };
}

export function HoldingCandlestickChart({ currency, name, onClose, onRetryRealtime, profitColorScheme, realtimeQuote, realtimeState, sourceId, symbol }: {
  currency: string;
  name: string;
  onClose(): void;
  onRetryRealtime?: () => void;
  profitColorScheme: ProfitColorScheme;
  realtimeQuote?: LongbridgeRealtimeQuote;
  realtimeState?: LongbridgeRealtimeState;
  sourceId: string;
  symbol: string;
}) {
  const [period, setPeriod] = useState<LongbridgeHoldingCandlePeriod>("day");
  const session = useMemo(() => createChartSession(sourceId, symbol), [sourceId, symbol]);
  const [loaded, setLoaded] = useState<{ session: typeof session; period: LongbridgeHoldingCandlePeriod; data: LoadedData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestCurrent = useRef<() => Promise<void>>(async () => {});
  const boundaryAttempt = useRef({ session, key: "", at: 0 });
  const previousConnection = useRef(realtimeState);
  const quote = holdingChartQuote(realtimeQuote, symbol);

  useEffect(() => () => session.clear(), [session]);

  useEffect(() => {
    let active = true;
    let reading = false;
    setError(null);
    const cached = session.cache.get(period);
    if (cached) setLoaded({ session, period, data: cached });
    setLoading(!cached);
    async function update(fresh = false) {
      if (reading) return;
      reading = true;
      if (active) setLoading(true);
      try {
        const data = await session.read(period, fresh);
        if (active) {
          setLoaded({ session, period, data });
          setError(null);
        }
      } catch (caught) {
        if (!active) return;
        if (caught instanceof Error && caught.message === OWNER_SESSION_EXPIRED_MESSAGE) setLoaded(null);
        setError(caught instanceof Error ? caught.message : "长桥 K 线读取失败");
      } finally {
        reading = false;
        if (active) setLoading(false);
      }
    }
    const request = () => update(true);
    requestCurrent.current = request;
    const updateVisible = () => { if (document.visibilityState !== "hidden") void update(true); };
    void update();
    document.addEventListener("visibilitychange", updateVisible);
    window.addEventListener("focus", updateVisible);
    return () => {
      active = false;
      if (requestCurrent.current === request) requestCurrent.current = async () => {};
      document.removeEventListener("visibilitychange", updateVisible);
      window.removeEventListener("focus", updateVisible);
    };
  }, [period, session]);

  useEffect(() => {
    if (!quote) return;
    session.receiveQuote(quote);
    const data = session.cache.get(period);
    if (data) setLoaded({ session, period, data });
  }, [quote, period, session]);

  const current = loaded?.session === session && loaded.period === period ? loaded.data : session.cache.get(period) ?? null;
  useEffect(() => {
    if (!quote || !current || document.visibilityState === "hidden" || longbridgeQuoteSession(quote.trade_session) !== "regular") return;
    const time = longbridgeQuoteTime(quote.timestamp)!;
    const last = period === "five-day" ? current.trend.at(-1) : current.candles.at(-1);
    if (!last || time <= Date.parse(last.time)) return;
    const bucket = holdingCandleBucket(symbol, period, time);
    if (holdingCandleBucket(symbol, period, Date.parse(last.time)) === bucket) return;
    const key = `${period}:${bucket}`;
    const attempt = boundaryAttempt.current;
    if (attempt.session === session && attempt.key === key && Date.now() - attempt.at < 5_000) return;
    // 推送跨入缺失周期才补历史；失败后的重试也由后续行情触发，不设轮询。
    const timer = window.setTimeout(() => {
      boundaryAttempt.current = { session, key, at: Date.now() };
      void requestCurrent.current();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [quote, current, period, session, symbol]);

  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = realtimeState;
    if (realtimeState === "ready" && previous !== "ready") {
      // 保留各周期可用图，后台补齐断线期间可能漏掉的柱。
      session.invalidate();
      if (document.visibilityState !== "hidden") void requestCurrent.current();
    }
  }, [realtimeState, session]);

  // 首屏成功后最多两个后台读取；先预取五日，避免反复切换时串行等待网络。
  const hasData = loaded?.session === session;
  useEffect(() => {
    if (!hasData || (realtimeState && realtimeState !== "ready")) return;
    let active = true;
    const queue = PERIODS.map((item) => item.value);
    async function worker() {
      while (active && queue.length > 0) {
        const next = queue.shift()!;
        try { await session.read(next); }
        catch { /* 预取失败留待用户切换时重试，不打断当前图表。 */ }
      }
    }
    void worker();
    void worker();
    return () => { active = false; };
  }, [hasData, realtimeState, session]);

  function reload() {
    void requestCurrent.current();
  }
  return (
    <VibeDialog
      actions={
        <div aria-label="K线周期" className="holding-candlestick-chart__periods" role="group">
          {PERIODS.map((item) => (
            <VibeButton aria-pressed={period === item.value} className="vibe-button--range" data-candle-period={item.value} key={item.value} onClick={() => setPeriod(item.value)} size="compact" type="button" variant="text">
              {item.label}
            </VibeButton>
          ))}
        </div>
      }
      aria-label={`查看 ${name} K线`}
      className="holding-candlestick-dialog"
      description={`${symbol}，${currency}，常规盘，未复权，${symbol.endsWith(".US") ? "纽约时间" : "交易所时间"}`}
      headerActions={
        <VibeButton aria-label="关闭K线" onClick={onClose} shape="square" size="compact" title="关闭" type="button" variant="text"><svg aria-hidden="true" className="vibe-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></VibeButton>
      }
      onClose={onClose}
      title={`${name} K线`}
      titleId="holding-candlestick-chart-title"
    >
      <div className="holding-candlestick-chart" data-testid="holding-candlestick-chart">
        {realtimeState && onRetryRealtime ? <LongbridgeRealtimeNotice state={realtimeState} retry={onRetryRealtime} sourceId={sourceId} /> : null}
        {error ? <VibeNotice role="alert" tone="error">{current ? `历史行情更新失败，保留上次数据：${error}` : error}{current ? <VibeButton disabled={loading} onClick={reload} size="compact" type="button" variant="text">重试</VibeButton> : null}</VibeNotice> : null}
        {current ? (
          <div aria-busy={loading}>
            <HoldingCandlestickPlot candles={current.candles} currency={currency} key={`${sourceId}:${symbol}:${period}`} period={period} profitColorScheme={profitColorScheme} realtimeQuote={quote ?? undefined} symbol={symbol} trend={current.trend} />
          </div>
        ) : (
          <div className="holding-candlestick-chart__status" role="status">
            <p>{loading ? "正在读取行情…" : "暂时无法显示行情"}</p>
            {!loading ? <VibeButton onClick={reload} size="compact" type="button">重试</VibeButton> : null}
          </div>
        )}
      </div>
    </VibeDialog>
  );
}
