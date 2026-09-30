import { longbridgeQuoteTime } from "@/domain/longbridge-realtime";
import { LongbridgeKeychainSdk, type LongbridgeSdkCandlestick, type LongbridgeSdkDailyCandle, type LongbridgeSdkTrendPoint } from "@/server/asset-sources/longbridge-keychain-sdk";
import { LongbridgeServeClient } from "@/server/asset-sources/longbridge-serve-client";
import type { LongbridgeHoldingCandlestickPeriod } from "@/server/ports";

type Serve = Pick<LongbridgeServeClient, "call" | "close">;

function decimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+(?:[.][0-9]+)?$/.test(value)) {
    throw new Error("长桥 serve K 线 " + field + " 格式无效");
  }
  return value;
}

function candlestick(value: unknown): LongbridgeSdkCandlestick {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("长桥 serve K 线响应格式无效");
  }
  const raw = value as Record<string, unknown>;
  // serve 的 candlesticks 默认返回常规盘；拒绝混入盘前、盘后或未知时段。
  if (raw.trade_session !== "Intraday") throw new Error("长桥 serve K 线不是常规盘数据");
  const time = longbridgeQuoteTime(raw.timestamp);
  if (time === null || time < 0) throw new Error("长桥 serve K 线时间格式无效");
  const volume = typeof raw.volume === "number" && Number.isSafeInteger(raw.volume) && raw.volume >= 0
    ? String(raw.volume) : raw.volume;
  return {
    timestamp: Math.floor(time / 1_000),
    open: decimal(raw.open, "open"), high: decimal(raw.high, "high"),
    low: decimal(raw.low, "low"), close: decimal(raw.close, "close"),
    volume: decimal(volume, "volume"), turnover: decimal(raw.turnover, "turnover"),
  };
}

/** 所有 K 线通过 CLI serve 读取；Keychain 仅保留已绑定来源的本地引用。 */
export class LongbridgeServeMarketData {
  constructor(private readonly createClient: () => Serve = () => new LongbridgeServeClient()) {}

  credentialReference(): string {
    return new LongbridgeKeychainSdk().credentialReference();
  }

  private async candles(client: Serve, symbol: string, period: string, count: number): Promise<LongbridgeSdkCandlestick[]> {
    const result = await client.call("quote.candlesticks", { symbol, period, count, adjust: "none" });
    if (!Array.isArray(result)) throw new Error("长桥 serve K 线列表缺失");
    return result.map(candlestick);
  }

  async readCandlesticks(symbol: string, period: LongbridgeHoldingCandlestickPeriod, count: number): Promise<LongbridgeSdkCandlestick[]> {
    const client = this.createClient();
    try {
      return await this.candles(client, symbol, period === "min-1" ? "1m" : period, count);
    } finally {
      await client.close();
    }
  }

  async readFiveDayTrend(symbol: string, count: number): Promise<LongbridgeSdkTrendPoint[]> {
    const client = this.createClient();
    try {
      return (await this.candles(client, symbol, "5m", count)).map(({ timestamp, close }) => ({ timestamp, close }));
    } finally {
      await client.close();
    }
  }

  async readDailyCandles(symbols: string[]): Promise<LongbridgeSdkDailyCandle[]> {
    if (!symbols.length) return [];
    const client = this.createClient();
    try {
      const result: LongbridgeSdkDailyCandle[] = [];
      for (const symbol of symbols) {
        const candles = await this.candles(client, symbol, "day", 3);
        const latest = candles.reduce<LongbridgeSdkCandlestick | undefined>((latest, candle) =>
          !latest || candle.timestamp > latest.timestamp ? candle : latest, undefined);
        if (!latest) throw new Error("长桥日 K 缺少数据：" + symbol);
        result.push({ symbol, close: latest.close, timestamp: latest.timestamp, tradeSession: "intraday" });
      }
      return result;
    } finally {
      await client.close();
    }
  }
}
