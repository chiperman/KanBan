import type { PriceQuote, Prices } from "@/server/ports";

export class FakePrices implements Prices {
  private readonly quotes = new Map<string, PriceQuote>();

  setQuote(quote: PriceQuote | null): void {
    this.quotes.clear();
    if (quote) this.quotes.set(quote.symbol, quote);
  }

  async quote(symbol: string): Promise<PriceQuote | null> {
    return this.quotes.get(symbol) ?? null;
  }
}