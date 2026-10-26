import type { AssetClass, AssetExchangeRate, AssetMoney } from "@/domain/assets";

export type FormalSettlementStatus = "complete" | "incomplete" | "missed";

export type FormalSettlementAnchor =
  | {
      key: string;
      kind: "securities-close";
      market: SecuritiesMarket;
      tradingDay: string;
      scheduledCloseAt: string;
    }
  | {
      key: string;
      kind: "crypto-cutoff";
      market: null;
      tradingDay: string;
      scheduledCloseAt: string;
    };

export type SecuritiesMarket = "US" | "HK" | "SH" | "SZ" | "SG";

export interface FormalSettlementSource {
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string | null;
  status: FormalSettlementStatus;
  diagnostic: string | null;
  total: Record<"USD" | "CNY" | "HKD", string | null>;
}

export interface FormalSettlementHolding {
  sourceId: string;
  sourceAsset: string | null;
  symbol: string;
  name: string;
  quantity: string;
  assetClass: AssetClass;
  price: AssetMoney | null;
  priceBasis: "official-close" | "capture-time" | "unavailable";
  priceObservedAt: string | null;
  market: SecuritiesMarket | null;
  marketTradingDay: string | null;
  marketValue: string | null;
  diagnostic: string | null;
}

export interface FormalDailySettlement {
  anchor: FormalSettlementAnchor;
  capturedAt: string | null;
  status: FormalSettlementStatus;
  diagnostic: string | null;
  total: Record<"USD" | "CNY" | "HKD", string | null>;
  exchangeRates: AssetExchangeRate[];
  sources: FormalSettlementSource[];
  holdings: FormalSettlementHolding[];
}

export interface MarketTradingDays {
  tradingDays: string[];
  halfTradingDays: string[];
}
