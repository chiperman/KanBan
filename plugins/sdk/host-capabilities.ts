import type { EvmChain } from "@/domain/asset-source-providers";

/** Host configuration reads only; management and persistence stay in core. */
export interface ExternalServiceConfigurationReader {
  coinGeckoDemoApiKey(): Promise<string | null>;
  rpcUrl(chain: EvmChain): Promise<string | null>;
}

export interface PriceQuote {
  symbol: string;
  currency: string;
  price: string;
  quotedAt: Date;
}

/** Missing reference prices stay null; they never imply a zero valuation. */
export interface Prices {
  quote(symbol: string): Promise<PriceQuote | null>;
}
