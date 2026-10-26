import type { FormalSettlementStatus, FormalSettlementAnchor, SecuritiesMarket, FormalSettlementSource, FormalSettlementHolding, FormalDailySettlement, MarketTradingDays } from "@/domain/formal-settlements";
export type { FormalSettlementStatus, FormalSettlementAnchor, SecuritiesMarket, FormalSettlementSource, FormalSettlementHolding, FormalDailySettlement, MarketTradingDays } from "@/domain/formal-settlements";
import type { AssetSnapshot } from "./assets";
import type { AssetSourceSummary } from "./sources";

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
