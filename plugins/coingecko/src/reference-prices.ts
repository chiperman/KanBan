import type { ExternalServiceConfigurationReader, PriceQuote, Prices } from "../../sdk/host-capabilities";
import { createJsonDecoder } from "../../sdk/json";
const { record } = createJsonDecoder("CoinGecko");
type ReferenceFetch = typeof globalThis.fetch;

const COINGECKO_USD_REFERENCE_IDS = {
  BTC: "bitcoin",
  USDT: "tether",
} as const;

export class CoinGeckoUsdtUsdPrices implements Prices {
  private inFlightQuotes: Promise<ReadonlyMap<string, PriceQuote>> | null = null;

  constructor(
    private readonly services: Pick<ExternalServiceConfigurationReader, "coinGeckoDemoApiKey">,
    private readonly request: ReferenceFetch = globalThis.fetch,
  ) {}

  async quote(symbol: string): Promise<PriceQuote | null> {
    const normalized = symbol.toUpperCase();
    if (!(normalized in COINGECKO_USD_REFERENCE_IDS)) return null;
    return (await this.quotes()).get(normalized) ?? null;
  }

  private quotes(): Promise<ReadonlyMap<string, PriceQuote>> {
    if (this.inFlightQuotes !== null) return this.inFlightQuotes;
    const current = this.readQuotes();
    this.inFlightQuotes = current;
    void current.finally(() => {
      if (this.inFlightQuotes === current) this.inFlightQuotes = null;
    });
    return current;
  }

  private async readQuotes(): Promise<ReadonlyMap<string, PriceQuote>> {
    try {
      const url = new URL("https://api.coingecko.com/api/v3/simple/price");
      url.searchParams.set(
        "ids",
        Object.values(COINGECKO_USD_REFERENCE_IDS).join(","),
      );
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      const apiKey = await this.services.coinGeckoDemoApiKey();
      if (!apiKey) return new Map();
      const response = await this.request(url, {
        method: "GET",
        headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return new Map();
      const body = record(
        await response.json().catch(() => null),
        "CoinGecko 响应",
      );
      const quotes = new Map<string, PriceQuote>();
      for (const [symbol, coinId] of Object.entries(
        COINGECKO_USD_REFERENCE_IDS,
      )) {
        try {
          const coin = record(body[coinId], `CoinGecko ${symbol} 响应`);
          const price = typeof coin.usd === "number" && Number.isFinite(coin.usd)
            ? String(coin.usd)
            : typeof coin.usd === "string"
              ? coin.usd
              : null;
          const updatedAt = typeof coin.last_updated_at === "number"
            ? new Date(coin.last_updated_at * 1000)
            : null;
          if (
            !price ||
            !/^\d+(?:\.\d+)?$/.test(price) ||
            !updatedAt ||
            Number.isNaN(updatedAt.getTime())
          ) {
            continue;
          }
          quotes.set(symbol, {
            symbol,
            currency: "USD",
            price,
            quotedAt: updatedAt,
          });
        } catch {
          // 单一参考币缺价不应掩盖同批其他有效报价。
        }
      }
      return quotes;
    } catch {
      return new Map();
    }
  }
}
