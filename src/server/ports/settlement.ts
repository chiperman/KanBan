import type { AssetClass, AssetExchangeRate, AssetMoney, AssetSnapshot } from "./assets";
import type { AssetSourceSummary } from "./sources";

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

export interface FormalDailySettlements {
  list(): Promise<FormalDailySettlement[]>;
  recordIfAbsent(settlement: FormalDailySettlement): Promise<boolean>;
}

export interface FormalSettlementSourceCapture {
  capture(input: {
    source: AssetSourceSummary;
    attemptedAt: string;
  }): Promise<AssetSnapshot>;
}

export interface FormalSettlementDailyCandle {
  symbol: string;
  close: string;
  timestamp: string;
  tradeSession: "intraday";
}

export interface FormalSettlementCandleReader {
  readDailyCandles(input: {
    source: AssetSourceSummary;
    symbols: string[];
  }): Promise<FormalSettlementDailyCandle[]>;
}

export interface MarketTradingDays {
  tradingDays: string[];
  halfTradingDays: string[];
}

export interface FormalSettlementTradingCalendar {
  readTradingDays(input: {
    market: SecuritiesMarket;
    start: string;
    end: string;
  }): Promise<MarketTradingDays>;
}

export interface FormalDailySettlementRunner {
  run(): Promise<FormalSettlementRunResult>;
}

export type FormalSettlementRunReason =
  | "no-sources" | "before-window" | "market-closed" | "calendar-read-failed" | "official-close-pending"
  | "source-read-failed" | "candle-read-failed" | "capture-window-missed"
  | "incomplete-evidence" | "execution-failed" | "execution-record-failed";

export interface FormalSettlementRunResult {
  outcome: "not-due" | "waiting" | "recorded" | "already-recorded" | "error";
  reason?: FormalSettlementRunReason;
  settlementStatus?: FormalSettlementStatus;
}

export interface FormalSettlementExecution {
  startedAt: string;
  finishedAt: string;
  outcome: FormalSettlementRunResult["outcome"];
  reason: FormalSettlementRunReason | null;
  settlementStatus: FormalSettlementStatus | null;
}

export interface FormalSettlementExecutions {
  latest(): Promise<FormalSettlementExecution | null>;
  record(execution: FormalSettlementExecution): Promise<void>;
}

export interface FormalSettlementSchedulerStatus {
  state: "loaded" | "not-loaded" | "plist-missing" | "query-failed" | "unsupported";
  checkedAt: string;
}

export interface FormalSettlementScheduler {
  read(): Promise<FormalSettlementSchedulerStatus>;
}
