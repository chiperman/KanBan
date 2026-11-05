import { LongbridgeServeClient } from "./longbridge-serve-client";
import type { FormalSettlementTradingCalendar, MarketTradingDays, SecuritiesMarket } from "@/server/ports";

type Serve = Pick<LongbridgeServeClient, "call" | "close">;

function dates(value: unknown, start: string, end: string): string[] {
  if (!Array.isArray(value) || value.some(day =>
    typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day ||
    day < start || day > end,
  )) throw new Error("长桥交易日历日期格式无效");
  return [...new Set(value as string[])].sort();
}

/** Official trading/half-trading dates via the same read-only CLI transport as market data.
 * Contract: https://open.longbridge.com/docs/cli/serve (quote.trading_days).
 */
export class LongbridgeTradingCalendar implements FormalSettlementTradingCalendar {
  constructor(private readonly createClient: () => Serve = () => new LongbridgeServeClient()) {}

  async readTradingDays(input: { market: SecuritiesMarket; start: string; end: string }): Promise<MarketTradingDays> {
    const client = this.createClient();
    try {
      const result = await client.call("quote.trading_days", {
        market: input.market === "SH" || input.market === "SZ" ? "CN" : input.market,
        start: input.start, end: input.end,
      });
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("长桥交易日历响应缺失");
      }
      const raw = result as Record<string, unknown>;
      return {
        tradingDays: dates(raw.trading_days, input.start, input.end),
        halfTradingDays: dates(raw.half_trading_days, input.start, input.end),
      };
    } finally {
      await client.close();
    }
  }
}
