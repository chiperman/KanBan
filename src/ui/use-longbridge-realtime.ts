"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyLongbridgeRealtimeQuote,
  longbridgeQuoteTime,
  longbridgeQuotePeriod,
  type LongbridgeRealtimeQuote,
} from "@/domain/longbridge-realtime";
import type { AssetSourceSummary } from "@/server/ports";

export type LongbridgeRealtimeState =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "authentication-required"
  | "cli-unavailable"
  | "unavailable";

type RealtimeSource = Pick<AssetSourceSummary, "id" | "kind" | "lifecycle" | "snapshot">;
export type ReceivedQuote = { quote: LongbridgeRealtimeQuote; observedAt: string };
type QuoteBatch = { key: string; quotes: Map<string, ReceivedQuote> };
const EMPTY_QUOTES: ReadonlyMap<string, ReceivedQuote> = new Map();
// 给 1.2 秒金额动画留出播放与停顿时间。
const QUOTE_BATCH_MS = 2_000;

export function useLongbridgeRealtime<T extends RealtimeSource>(
  sources: T[],
  enabled = true,
  { immediateInitialQuotes = false }: { immediateInitialQuotes?: boolean } = {},
) {
  const [state, setState] = useState<LongbridgeRealtimeState>("idle");
  const [retryKey, setRetryKey] = useState(0);
  const [batch, setBatch] = useState<QuoteBatch>(() => ({ key: "", quotes: new Map() }));
  const latest = useRef<QuoteBatch>({ key: "", quotes: new Map() });
  const { subscriptionKey, symbolsKey } = useMemo(() => {
    const connected = sources.filter((source) =>
      enabled && source.kind === "longbridge" && source.lifecycle !== "disconnected",
    );
    const symbols = [...new Set(connected.flatMap((source) => source.snapshot.holdings)
      .filter((holding) => holding.assetClass !== "cash" && !holding.symbol.startsWith("CASH."))
      .map((holding) => holding.symbol))].sort().join(",");
    return {
      subscriptionKey: symbols ? JSON.stringify([connected.map((source) => source.id).sort(), symbols]) : "",
      symbolsKey: symbols,
    };
  }, [sources, enabled]);

  useEffect(() => {
    if (latest.current.key !== subscriptionKey) {
      latest.current = { key: subscriptionKey, quotes: new Map() };
      setBatch({ key: subscriptionKey, quotes: new Map() });
    }
    if (!subscriptionKey) {
      setState("idle");
      return;
    }
    const symbols = new Set(symbolsKey.split(","));
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState("connecting");
    const stream = new EventSource("/api/asset-sources/stream");
    const handleQuote = (event: Event) => {
      try {
        let quote = JSON.parse((event as MessageEvent<string>).data) as LongbridgeRealtimeQuote;
        if (!quote || !symbols.has(quote.symbol) || typeof quote.last_done !== "string" ||
          !/^\d+(?:\.\d+)?$/.test(quote.last_done) || longbridgeQuoteTime(quote.timestamp) === null) return;
        const previous = latest.current.quotes.get(quote.symbol)?.quote;
        if (previous) {
          const previousAt = longbridgeQuoteTime(previous.timestamp);
          const nextAt = longbridgeQuoteTime(quote.timestamp);
          if (nextAt === null || (previousAt !== null && nextAt < previousAt)) return;
          if (quote.prev_close === undefined && longbridgeQuotePeriod(quote) === longbridgeQuotePeriod(previous)) {
            quote = { ...quote, prev_close: previous.prev_close };
          }
          if (previous.last_done === quote.last_done && previous.timestamp === quote.timestamp &&
            previous.prev_close === quote.prev_close && previous.trade_status === quote.trade_status &&
            previous.trade_session === quote.trade_session && previous.open === quote.open &&
            previous.high === quote.high && previous.low === quote.low &&
            previous.volume === quote.volume && previous.turnover === quote.turnover) return;
        }
        latest.current.quotes.set(quote.symbol, { quote, observedAt: new Date().toISOString() });
        // 持仓表首条行情或首次补齐参考价时立即显示，后续仍按固定窗口合并。
        if (immediateInitialQuotes &&
          (!previous || (previous.prev_close === undefined && quote.prev_close !== undefined))) {
          setBatch({ key: subscriptionKey, quotes: new Map(latest.current.quotes) });
          return;
        }
        // 固定窗口合并行情，持续推送时也按时显示最新值。重连保留已收到的行情。
        if (timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            setBatch({ key: subscriptionKey, quotes: new Map(latest.current.quotes) });
          }, QUOTE_BATCH_MS);
        }
      } catch {
        // 单条异常消息不影响后续行情。
      }
    };
    const handleStatus = (event: Event) => {
      try {
        const status = JSON.parse((event as MessageEvent<string>).data) as { state?: string; code?: string };
        if (status.state === "connecting") setState("connecting");
        else if (status.state === "ready") setState("ready");
        else if (status.state === "error") {
          setState(status.code === "authentication-required"
            ? "authentication-required"
            : status.code === "cli-unavailable" ? "cli-unavailable" : "unavailable");
        }
      } catch {
        setState("unavailable");
      }
    };
    const handleError = () => setState((current) =>
      current === "authentication-required" || current === "cli-unavailable"
        ? current : "reconnecting",
    );
    stream.addEventListener("quote", handleQuote);
    stream.addEventListener("stream-status", handleStatus);
    stream.addEventListener("error", handleError);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      stream.removeEventListener("quote", handleQuote);
      stream.removeEventListener("stream-status", handleStatus);
      stream.removeEventListener("error", handleError);
      stream.close();
    };
  }, [subscriptionKey, symbolsKey, retryKey, immediateInitialQuotes]);

  const liveSources = useMemo(() => {
    if (batch.key !== subscriptionKey || batch.quotes.size === 0) return sources;
    return sources.map((source) => {
      if (source.kind !== "longbridge" || source.lifecycle === "disconnected") return source;
      return [...batch.quotes.values()].reduce(
        (current, { quote, observedAt }) => applyLongbridgeRealtimeQuote(current, quote, observedAt),
        source,
      );
    });
  }, [batch, sources, subscriptionKey]);

  return {
    active: subscriptionKey !== "",
    liveSources,
    quotes: batch.key === subscriptionKey ? batch.quotes as ReadonlyMap<string, ReceivedQuote> : EMPTY_QUOTES,
    state,
    retry: () => {
      setState("connecting");
      setRetryKey((current) => current + 1);
    },
  };
}
