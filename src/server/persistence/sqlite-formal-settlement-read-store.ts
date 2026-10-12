import type { SqliteRow } from "@/server/persistence/contracts";
import type { FormalDailySettlement } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

/** 正式日结批量查询与证据行解码；不承担写入或事务。 */
export class SqliteFormalSettlementReadStore {
  constructor(private readonly database: DatabaseSync) {}

  list(): FormalDailySettlement[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM formal_daily_settlements
        ORDER BY scheduled_close_at DESC, anchor_key DESC
      `)
      .all() as SqliteRow[];
    const grouped = (
      table:
        | "formal_daily_settlement_sources"
        | "formal_daily_settlement_holdings",
    ) => {
      const groups = new Map<string, SqliteRow[]>();
      for (const child of this.database
        .prepare("SELECT * FROM " + table + " ORDER BY rowid")
        .all() as SqliteRow[]) {
        const key = child.anchor_key as string;
        const values = groups.get(key) ?? [];
        values.push(child);
        groups.set(key, values);
      }
      return groups;
    };
    const sourceGroups = grouped("formal_daily_settlement_sources");
    const holdingGroups = grouped("formal_daily_settlement_holdings");
    return rows.map((row) => {
      const anchor = row.anchor_kind === "securities-close"
        ? {
            key: row.anchor_key as string,
            kind: "securities-close" as const,
            market: row.anchor_market as NonNullable<
              FormalDailySettlement["anchor"] extends { market: infer Market }
                ? Market
                : never
            >,
            tradingDay: row.anchor_trading_day as string,
            scheduledCloseAt: row.scheduled_close_at as string,
          }
        : {
            key: row.anchor_key as string,
            kind: "crypto-cutoff" as const,
            market: null,
            tradingDay: row.anchor_trading_day as string,
            scheduledCloseAt: row.scheduled_close_at as string,
          };
      const sources = sourceGroups.get(row.anchor_key as string) ?? [];
      const holdings = holdingGroups.get(row.anchor_key as string) ?? [];
      return {
        anchor,
        capturedAt: row.captured_at as string | null,
        status: row.status as FormalDailySettlement["status"],
        diagnostic: row.diagnostic as string | null,
        total: {
          USD: row.total_usd as string | null,
          CNY: row.total_cny as string | null,
          HKD: row.total_hkd as string | null,
        },
        exchangeRates: JSON.parse(row.exchange_rates_json as string),
        sources: sources.map((source) => ({
          sourceId: source.source_id as string,
          label: source.label as string,
          kind: source.kind as string,
          capturedAt: source.captured_at as string | null,
          status: source.status as FormalDailySettlement["status"],
          diagnostic: source.diagnostic as string | null,
          total: {
            USD: source.total_usd as string | null,
            CNY: source.total_cny as string | null,
            HKD: source.total_hkd as string | null,
          },
        })),
        holdings: holdings.map((holding) => ({
          sourceId: holding.source_id as string,
          sourceAsset: holding.source_asset as string | null,
          symbol: holding.symbol as string,
          name: holding.name as string,
          quantity: holding.quantity as string,
          assetClass: holding.asset_class as "securities" | "crypto" | "cash",
          price: holding.price_amount === null
            ? null
            : {
                amount: holding.price_amount as string,
                currency: holding.price_currency as string,
              },
          priceBasis: holding.price_basis as
            | "official-close"
            | "capture-time"
            | "unavailable",
          priceObservedAt: holding.price_observed_at as string | null,
          market: holding.market as FormalDailySettlement["anchor"]["market"],
          marketTradingDay: holding.market_trading_day as string | null,
          marketValue: holding.market_value as string | null,
          diagnostic: holding.diagnostic as string | null,
        })),
      };
    });
  }
}
