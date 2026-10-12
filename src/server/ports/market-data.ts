import type { AssetSourceSummary } from "./sources";

/** 长桥持仓图表的产品展示周期。five-day 是近五个交易日的 5 分钟走势。 */
export type LongbridgeHoldingCandlePeriod =
  | "five-day"
  | "day"
  | "week"
  | "month"
  | "year"
  | "min-1";

export type LongbridgeHoldingCandlestickPeriod = Exclude<
  LongbridgeHoldingCandlePeriod,
  "five-day"
>;

/** 只传递普通 OHLCV，不暴露任何账户或凭证信息。 */
export interface LongbridgeHoldingCandlestick {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

/** 近五日走势仅传递收盘价与时间，不关联账户或凭证信息。 */
export interface LongbridgeHoldingTrendPoint {
  time: string;
  price: string;
}

export interface LongbridgeHoldingCandlestickReader {
  readFiveDayTrend(input: {
    source: AssetSourceSummary;
    symbol: string;
  }): Promise<LongbridgeHoldingTrendPoint[]>;

  readCandlesticks(input: {
    source: AssetSourceSummary;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }): Promise<LongbridgeHoldingCandlestick[]>;
}

/** 仅限收益分析的长桥价格指数日 K；不关联账户持仓。 */
export type LongbridgeBenchmarkSymbol = ".SPX.US" | ".NDX.US";

export interface LongbridgeBenchmarkCandlestick {
  close: string;
  time: string;
}

export interface LongbridgeBenchmarkCandlestickReader {
  readDailyCandlesticks(input: {
    count: number;
    symbol: LongbridgeBenchmarkSymbol;
  }): Promise<LongbridgeBenchmarkCandlestick[]>;
}

export interface PriceQuote {
  symbol: string;
  currency: string;
  price: string;
  quotedAt: Date;
}

/** 独立参考价格来源；无可靠价格时返回 null（未估值资产不得按零计）。 */
export interface Prices {
  quote(symbol: string): Promise<PriceQuote | null>;
}
