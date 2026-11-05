import {
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
} from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";
import { revalueLongbridgeSnapshot } from "@/domain/longbridge-valuation";
import type { AssetQuoteSession } from "@/domain/assets";
import type { AssetSourceSummary } from "@/domain/asset-sources";

export interface LongbridgeRealtimeQuote {
  symbol: string;
  last_done: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string | number;
  turnover?: string;
  prev_close?: string;
  timestamp?: number | string;
  trade_status?: string;
  trade_session?: string | number;
}

/** serve uses RFC3339; the OpenAPI protocol also accepts Unix seconds. */
export function longbridgeQuoteTime(raw: unknown): number | null {
  const milliseconds = typeof raw === "number" || (typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw))
    ? Number(raw) * 1_000
    : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && !Number.isNaN(new Date(milliseconds).getTime())
    ? milliseconds : null;
}

export function longbridgeQuoteSession(raw: unknown): AssetQuoteSession {
  switch (String(raw).toLowerCase()) {
    case "0": case "intraday": return "regular";
    case "1": case "pre": return "pre-market";
    case "2": case "post": return "post-market";
    case "3": case "overnight": return "overnight";
    default: return "unknown";
  }
}

/** Reference prices may only be reused within the same session and date. */
export function longbridgeQuotePeriod(quote: LongbridgeRealtimeQuote): string {
  const time = longbridgeQuoteTime(quote.timestamp);
  return longbridgeQuoteSession(quote.trade_session) + ":" + (time === null ? "" : new Date(time).toISOString().slice(0, 10));
}

export function applyLongbridgeRealtimeQuote<T extends Pick<AssetSourceSummary, "kind" | "snapshot">>(
  source: T,
  quote: LongbridgeRealtimeQuote,
  observedAt = new Date().toISOString(),
): T {
  if (source.kind !== "longbridge" || !/^\d+(?:\.\d+)?$/.test(quote.last_done)) {
    return source;
  }
  const index = source.snapshot.holdings.findIndex((holding) => holding.symbol === quote.symbol);
  if (index < 0) return source;
  const current = source.snapshot.holdings[index];
  const time = longbridgeQuoteTime(quote.timestamp);
  const currentTime = longbridgeQuoteTime(current.quoteEvidence?.quotedAt);
  if (current.assetClass === "cash" || time === null || (currentTime !== null && time < currentTime)) return source;

  const quotedAt = new Date(time).toISOString();
  const session = longbridgeQuoteSession(quote.trade_session);
  const samePeriod = session !== "unknown" && session === current.quoteEvidence?.session &&
    currentTime !== null && quotedAt.slice(0, 10) === new Date(currentTime).toISOString().slice(0, 10);
  const price = quote.last_done;
  const marketValue = decimalMultiply(current.quantity, price);
  const sourceMarketValueAmount = convertCurrencyAmount(
    marketValue,
    current.currency,
    source.snapshot.total.currency,
    source.snapshot.exchangeRates,
  );
  const platformProfit = current.costPrice === null
    ? current.platformProfit
    : decimalMultiply(current.quantity, decimalSubtract(price, current.costPrice));
  const previousClose = quote.prev_close ?? (samePeriod ? current.previousClose?.amount ?? null : null);
  const changePercent = previousClose === null || decimalCompare(previousClose, "0") === 0
    ? null
    : decimalMultiply(decimalDivide(decimalSubtract(price, previousClose), previousClose), "100");
  const valuation = sourceMarketValueAmount === null
    ? { status: "unvalued" as const, reason: "缺少实时行情折算汇率" }
    : { status: "valued" as const, priceSource: "Longbridge serve 行情", pricedAt: quotedAt };

  const nextHolding = {
    ...current,
    currentPrice: { amount: price, currency: current.currency },
    marketValue,
    sourceMarketValue: sourceMarketValueAmount === null
      ? null
      : { amount: sourceMarketValueAmount, currency: source.snapshot.total.currency },
    previousClose: previousClose === null
      ? null
      : { amount: previousClose, currency: current.currency },
    platformProfit,
    changePercent,
    quoteEvidence: {
      session,
      quotedAt,
      observedAt,
      freshness: "current" as const,
      delivery: "unknown" as const,
      provider: {
        name: "longbridge",
        tradeStatus: quote.trade_status ?? null,
      },
    },
    valuation,
  };
  const holdings = [...source.snapshot.holdings];
  holdings[index] = nextHolding;
  return {
    ...source,
    snapshot: revalueLongbridgeSnapshot({
      ...revalueLongbridgeSnapshot(source.snapshot),
      holdings,
    }),
  };
}
