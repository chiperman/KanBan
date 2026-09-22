import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
} from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";
import type { AssetSnapshot, AssetSourceSummary } from "@/server/ports";

export interface LongbridgeRealtimeQuote {
  symbol: string;
  last_done: string;
  prev_close?: string;
  timestamp?: number | string;
  trade_status?: string;
}

function quoteObservedAt(quote: LongbridgeRealtimeQuote, fallback: string): string {
  const raw = quote.timestamp;
  const seconds = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw)
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function newerThanCurrent(
  quote: LongbridgeRealtimeQuote,
  current: AssetSnapshot["holdings"][number],
): boolean {
  const currentAt = current.quoteEvidence?.quotedAt;
  if (!currentAt) return true;
  const nextAt = quoteObservedAt(quote, currentAt);
  return nextAt >= currentAt;
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
  if (current.assetClass === "cash" || !newerThanCurrent(quote, current)) return source;

  const quotedAt = quoteObservedAt(quote, observedAt);
  const price = quote.last_done;
  const marketValue = decimalMultiply(current.quantity, price);
  const sourceMarketValueAmount = convertCurrencyAmount(
    marketValue,
    current.currency,
    source.snapshot.total.currency,
    source.snapshot.exchangeRates,
  );
  const previousSourceMarketValue = current.sourceMarketValue?.amount ?? null;
  const total = sourceMarketValueAmount === null || previousSourceMarketValue === null
    ? source.snapshot.total.amount
    : decimalAdd(
        source.snapshot.total.amount,
        decimalSubtract(sourceMarketValueAmount, previousSourceMarketValue),
      );
  const platformProfit = current.costPrice === null
    ? current.platformProfit
    : decimalMultiply(current.quantity, decimalSubtract(price, current.costPrice));
  const previousClose = quote.prev_close ?? current.previousClose?.amount ?? null;
  const changePercent = previousClose === null || decimalCompare(previousClose, "0") === 0
    ? current.changePercent
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
      ? current.previousClose ?? null
      : { amount: previousClose, currency: current.currency },
    platformProfit,
    changePercent,
    quoteEvidence: {
      session: current.quoteEvidence?.session ?? "unknown",
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
    snapshot: {
      ...source.snapshot,
      total: { ...source.snapshot.total, amount: total },
      holdings,
    },
  };
}
