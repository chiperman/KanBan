import type { FormalDailySettlement } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

/** 正式日结证据的 SQLite 写入模块；事务边界由调用方持有。 */
export class SqliteFormalSettlementStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(settlement: FormalDailySettlement): boolean {
    const inserted = this.database
      .prepare(`
        INSERT INTO formal_daily_settlements (
          anchor_key, anchor_kind, anchor_market, anchor_trading_day,
          scheduled_close_at, captured_at, status, diagnostic,
          total_usd, total_cny, total_hkd, exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(anchor_key) DO NOTHING
      `)
      .run(
        settlement.anchor.key,
        settlement.anchor.kind,
        settlement.anchor.market,
        settlement.anchor.tradingDay,
        settlement.anchor.scheduledCloseAt,
        settlement.capturedAt,
        settlement.status,
        settlement.diagnostic,
        settlement.total.USD,
        settlement.total.CNY,
        settlement.total.HKD,
        JSON.stringify(settlement.exchangeRates),
      ).changes > 0;
    if (!inserted) return false;
    const sourceStatement = this.database.prepare(`
      INSERT INTO formal_daily_settlement_sources (
        anchor_key, source_id, label, kind, captured_at, status, diagnostic,
        total_usd, total_cny, total_hkd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of settlement.sources) {
      sourceStatement.run(
        settlement.anchor.key,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        source.status,
        source.diagnostic,
        source.total.USD,
        source.total.CNY,
        source.total.HKD,
      );
    }
    const holdingStatement = this.database.prepare(`
      INSERT INTO formal_daily_settlement_holdings (
        anchor_key, source_id, source_identity, source_asset, symbol, name,
        quantity, asset_class, price_amount, price_currency, price_basis,
        price_observed_at, market, market_trading_day, market_value, diagnostic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const holding of settlement.holdings) {
      holdingStatement.run(
        settlement.anchor.key,
        holding.sourceId,
        holding.sourceAsset ?? holding.symbol,
        holding.sourceAsset,
        holding.symbol,
        holding.name,
        holding.quantity,
        holding.assetClass,
        holding.price?.amount ?? null,
        holding.price?.currency ?? null,
        holding.priceBasis,
        holding.priceObservedAt,
        holding.market,
        holding.marketTradingDay,
        holding.marketValue,
        holding.diagnostic,
      );
    }
    return true;
  }
}
