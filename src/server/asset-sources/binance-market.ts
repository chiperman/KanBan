import { decimalAdd, decimalDivide } from "@/domain/decimal";
import { createJsonDecoder, type JsonRecord } from "@/server/asset-sources/json";
import { positiveDecimal } from "@/server/asset-sources/value-guards";

const { record, list } = createJsonDecoder("Binance");
const positive = positiveDecimal;

export interface BinanceEquityQuote {
  symbol: string;
  bidPrice: string;
  askPrice: string;
}

export function tickerPrices(
  tickers: unknown,
  neededSymbols: ReadonlySet<string>,
): Map<string, string> {
  const values = Array.isArray(tickers) ? tickers : [tickers];
  const prices = new Map<string, string>();
  for (const raw of values) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const item = raw as JsonRecord;
    const symbol = typeof item.symbol === "string" ? item.symbol : null;
    if (symbol === null || !neededSymbols.has(symbol)) continue;
    const price = typeof item.price === "string" &&
        /^\d+(?:\.\d+)?$/.test(item.price)
      ? item.price
      : null;
    if (price === null || !positive(price)) continue;
    prices.set(symbol, price);
  }
  return prices;
}

export function stocksSymbolForAsset(asset: string): string | null {
  if (!asset.startsWith("EQ_")) return null;
  const symbol = asset.slice("EQ_".length);
  return /^[A-Z][A-Z0-9.-]*$/.test(symbol) ? symbol : null;
}

export function equityMidPrice(quote: BinanceEquityQuote): string {
  return decimalDivide(decimalAdd(quote.bidPrice, quote.askPrice), "2");
}

export function eligibleUsdtSymbols(exchangeInfo: unknown): Set<string> {
  const root = record(exchangeInfo, "Binance exchangeInfo 响应");
  return new Set(
    list(root.symbols, "Binance exchangeInfo symbols").flatMap((item) =>
      item.status === "TRADING" &&
      item.isSpotTradingAllowed !== false &&
      item.quoteAsset === "USDT" &&
      typeof item.baseAsset === "string" &&
      typeof item.symbol === "string"
        ? [item.symbol]
        : [],
    ),
  );
}
