import type { DatabaseSync } from "node:sqlite";
import { SqliteSchemaMigrationStore } from "./sqlite-schema-migration-store";

/** Schema changes borrow the owner connection and transaction; they never open a database. */
export class DashboardSchema {
  constructor(private readonly database: DatabaseSync, private readonly transaction: <T>(operation: () => T) => T, private readonly metadata: (key: string) => string | null) {}

  createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS investment_book_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_sources (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        display_name TEXT,
        account_id TEXT NOT NULL,
        permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
        credential_reference TEXT,
        ignored_asset_keys_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(ignored_asset_keys_json)),
        included_asset_keys_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(included_asset_keys_json)),
        has_manual_record INTEGER NOT NULL DEFAULT 1
          CHECK (has_manual_record IN (0, 1)),
        manual_asset_class TEXT
          CHECK (
            manual_asset_class IS NULL OR
            manual_asset_class IN ('securities', 'crypto', 'cash', 'other')
          ),
        lifecycle TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('connected', 'disconnected'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_snapshots (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        total_amount TEXT NOT NULL,
        total_currency TEXT NOT NULL,
        holdings_json TEXT NOT NULL CHECK (json_valid(holdings_json)),
        unrecognized_evm_tokens_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(unrecognized_evm_tokens_json)),
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json)),
        coverage_json TEXT CHECK (coverage_json IS NULL OR json_valid(coverage_json)),
        synced_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_sync_states (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('current', 'expired')),
        last_successful_at TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        error TEXT,
        failed_mode TEXT CHECK (failed_mode IS NULL OR failed_mode IN ('all', 'prices', 'holdings')),
        diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
        recent_attempts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recent_attempts_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS manual_asset_records (
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY', 'HKD')),
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (source_id, day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_cards (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_id TEXT,
        hidden INTEGER CHECK (hidden IS NULL OR hidden IN (0, 1)),
        span INTEGER NOT NULL CHECK (span IN (1, 2, 3)),
        starts_new_row INTEGER CHECK (starts_new_row IS NULL OR starts_new_row IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_snapshots (
        day TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_source_snapshots (
        day TEXT NOT NULL REFERENCES daily_asset_snapshots(day) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        asset_class_totals_json TEXT
          CHECK (
            asset_class_totals_json IS NULL OR
            json_valid(asset_class_totals_json)
          ),
        PRIMARY KEY (day, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_trend_observations (
        day TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_source_trend_observations (
        day TEXT NOT NULL REFERENCES daily_asset_trend_observations(day) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        asset_class_totals_json TEXT
          CHECK (
            asset_class_totals_json IS NULL OR
            json_valid(asset_class_totals_json)
          ),
        PRIMARY KEY (day, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS imported_asset_source_history_observations (
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        PRIMARY KEY (source_id, day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_investment_histories (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS source_investment_records (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('opening', 'deposit', 'withdrawal', 'valuation')),
        amount TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY', 'HKD')),
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS source_investment_records_one_opening
        ON source_investment_records(source_id) WHERE kind = 'opening';
      CREATE UNIQUE INDEX IF NOT EXISTS source_investment_records_one_daily_valuation
        ON source_investment_records(source_id, day) WHERE kind = 'valuation';
      CREATE TABLE IF NOT EXISTS formal_settlement_execution (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        started_at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlements (
        anchor_key TEXT PRIMARY KEY,
        anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('securities-close', 'crypto-cutoff')),
        anchor_market TEXT,
        anchor_trading_day TEXT NOT NULL,
        scheduled_close_at TEXT NOT NULL,
        captured_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'missed')),
        diagnostic TEXT,
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlement_sources (
        anchor_key TEXT NOT NULL
          REFERENCES formal_daily_settlements(anchor_key) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'missed')),
        diagnostic TEXT,
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        PRIMARY KEY (anchor_key, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlement_holdings (
        anchor_key TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_identity TEXT NOT NULL,
        source_asset TEXT,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity TEXT NOT NULL,
        asset_class TEXT NOT NULL CHECK (asset_class IN ('securities', 'crypto', 'cash')),
        price_amount TEXT,
        price_currency TEXT,
        price_basis TEXT NOT NULL
          CHECK (price_basis IN ('official-close', 'capture-time', 'unavailable')),
        price_observed_at TEXT,
        market TEXT,
        market_trading_day TEXT,
        market_value TEXT,
        diagnostic TEXT,
        PRIMARY KEY (anchor_key, source_id, source_identity),
        FOREIGN KEY (anchor_key, source_id)
          REFERENCES formal_daily_settlement_sources(anchor_key, source_id)
          ON DELETE CASCADE
      ) STRICT;
    `);
    new SqliteSchemaMigrationStore(
      this.database,
      this.transaction,
      this.metadata,
    ).migrate();
  }
}
