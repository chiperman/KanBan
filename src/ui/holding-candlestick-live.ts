import { longbridgeQuoteSession, longbridgeQuoteTime, type LongbridgeRealtimeQuote } from "@/domain/longbridge-realtime";
import type { LongbridgeHoldingCandlePeriod, LongbridgeHoldingCandlestick, LongbridgeHoldingTrendPoint } from "@/server/ports";

export interface HoldingChartData {
  candles: LongbridgeHoldingCandlestick[];
  trend: LongbridgeHoldingTrendPoint[];
  receivedAt: number;
  quoteAt?: number;
}

export function holdingMarketTimeZone(symbol: string): string {
  switch (symbol.split(".").at(-1)?.toUpperCase()) {
    case "US": return "America/New_York";
    case "HK": return "Asia/Hong_Kong";
    case "SG": return "Asia/Singapore";
    default: return "Asia/Shanghai";
  }
}

/** 按交易所日期对齐周期，不用浏览器本地日期划分周/月/年。 */
export function holdingCandleBucket(symbol: string, period: LongbridgeHoldingCandlePeriod, time: number): string {
  if (period === "min-1" || period === "five-day") return String(Math.floor(time / (period === "min-1" ? 60_000 : 300_000)));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: holdingMarketTimeZone(symbol), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(time);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const day = `${value("year")}-${value("month")}-${value("day")}`;
  if (period === "year") return day.slice(0, 4);
  if (period === "month") return day.slice(0, 7);
  if (period === "week") {
    const monday = new Date(`${day}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  }
  return day;
}

export function holdingChartQuote(quote: LongbridgeRealtimeQuote | undefined, symbol: string): LongbridgeRealtimeQuote | null {
  return quote?.symbol === symbol && typeof quote.last_done === "string" && /^\d+(?:\.\d+)?$/.test(quote.last_done) &&
    longbridgeQuoteTime(quote.timestamp) !== null ? quote : null;
}

/** 只投影已存在的当前周期；缺失周期交给历史接口，不用报价猜开盘和成交量。 */
export function applyHoldingChartQuote(data: HoldingChartData, period: LongbridgeHoldingCandlePeriod, quote: LongbridgeRealtimeQuote): HoldingChartData {
  const time = longbridgeQuoteTime(quote.timestamp);
  if (time === null || longbridgeQuoteSession(quote.trade_session) !== "regular" || time < (data.quoteAt ?? 0)) return data;
  const last = period === "five-day" ? data.trend.at(-1) : data.candles.at(-1);
  if (!last || time < Date.parse(last.time) || holdingCandleBucket(quote.symbol, period, Date.parse(last.time)) !== holdingCandleBucket(quote.symbol, period, time)) return data;
  if (period === "five-day") return { ...data, quoteAt: time, trend: [...data.trend.slice(0, -1), { time: last.time, price: quote.last_done }] };
  const candle = data.candles.at(-1)!;
  const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value)
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? value : null;
  const daily = period === "day";
  const high = number(quote.high);
  const low = number(quote.low);
  return {
    ...data, quoteAt: time,
    candles: [...data.candles.slice(0, -1), {
      ...candle,
      open: daily ? number(quote.open) ?? candle.open : candle.open,
      high: String(Math.max(Number(candle.high), Number(quote.last_done), ...(high && period !== "min-1" ? [Number(high)] : []))),
      low: String(Math.min(Number(candle.low), Number(quote.last_done), ...(low && period !== "min-1" ? [Number(low)] : []))),
      close: quote.last_done,
      // 日内累计量不能充当分钟或周/月/年成交量；跨周期后补回真实 OHLCV。
      volume: daily ? number(quote.volume) ?? "" : "",
      turnover: daily ? number(quote.turnover) ?? "" : "",
    }],
  };
}
