import { shanghaiDay, sourceTrendClassTotals } from "@/domain/daily-asset-snapshots";
import type { SqliteRow } from "@/server/persistence/contracts";
import { SQLITE_SCHEMA_VERSION } from "@/server/persistence/contracts";
import type { AssetSourceSummary, DailyAssetSourceSnapshot, ManualAssetClass } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

/** Schema changes borrow the owner connection and transaction; they never open a database. */
export class DashboardSchema {
  constructor(private readonly database: DatabaseSync, private readonly transaction: <T>(operation: () => T) => T, private readonly metadata: (key: string) => string | null) {}

  createSchema(): void {
    this.database.exec(`
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
    let schemaVersion = this.metadata("schema_version");
    if (schemaVersion === null) {
      this.createInvestmentCashflowSchema();
      this.database
        .prepare("INSERT INTO schema_metadata (key, value) VALUES (?, ?)")
        .run("schema_version", String(SQLITE_SCHEMA_VERSION));
      return;
    }
    if (schemaVersion === "1") {
      this.migrateSchemaVersionOne();
      schemaVersion = "2";
    }
    if (schemaVersion === "2") {
      this.migrateSchemaVersionTwo();
      schemaVersion = "3";
    }
    if (schemaVersion === "3") {
      this.migrateSchemaVersionThree();
      schemaVersion = "4";
    }
    if (schemaVersion === "4") {
      this.migrateSchemaVersionFour();
      schemaVersion = "5";
    }
    if (schemaVersion === "5") {
      this.migrateSchemaVersionFive();
      schemaVersion = "6";
    }
    if (schemaVersion === "6") {
      this.migrateSchemaVersionSix();
      schemaVersion = "7";
    }
    if (schemaVersion === "7") {
      this.migrateSchemaVersionSeven();
      schemaVersion = "8";
    }
    if (schemaVersion === "8") {
      this.migrateSchemaVersionEight();
      schemaVersion = "9";
    }
    if (schemaVersion === "9") {
      this.migrateSchemaVersionNine();
      schemaVersion = "10";
    }
    if (schemaVersion === "10") {
      this.migrateSchemaVersionTen();
      schemaVersion = "11";
    }
    if (schemaVersion === "11") {
      this.migrateSchemaVersionEleven();
      schemaVersion = "12";
    }
    if (schemaVersion === "12") {
      this.migrateSchemaVersionTwelve();
      schemaVersion = "13";
    }
    if (schemaVersion === "13") {
      this.migrateSchemaVersionThirteen();
      schemaVersion = "14";
    }
    if (schemaVersion === "14") {
      this.migrateSchemaVersionFourteen();
      schemaVersion = "15";
    }
    if (schemaVersion === "15") {
      this.migrateSchemaVersionFifteen();
      schemaVersion = "16";
    }
    if (schemaVersion === "16") {
      this.migrateSchemaVersionSixteen();
      schemaVersion = "17";
    }
    if (schemaVersion === "17") {
      this.migrateSchemaVersionSeventeen();
      schemaVersion = "18";
    }
    if (schemaVersion === "18") {
      this.database.prepare("UPDATE schema_metadata SET value = '19' WHERE key = 'schema_version'").run();
      schemaVersion = "19";
    }
    if (schemaVersion === "19") {
      this.database.prepare("UPDATE schema_metadata SET value = '20' WHERE key = 'schema_version'").run();
      schemaVersion = "20";
    }
    if (schemaVersion !== String(SQLITE_SCHEMA_VERSION)) {
      throw new Error(`不支持的 SQLite schema 版本: ${schemaVersion}`);
    }
  }

  private createInvestmentCashflowSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS investment_cashflows (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (
          kind IN ('initial-investment', 'external-deposit', 'external-withdrawal')
        ),
        occurred_at TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY', 'HKD')),
        note TEXT,
        amount_usd TEXT,
        amount_cny TEXT,
        amount_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS investment_cashflows_one_initial
        ON investment_cashflows(kind)
        WHERE kind = 'initial-investment';
    `);
  }

  private migrateSchemaVersionOne(): void {
    this.transaction(() => {
      this.database.exec(`
        CREATE TEMP TABLE credential_references_before_migration AS
        SELECT id, credential_reference FROM asset_sources;
        ALTER TABLE asset_sources DROP COLUMN credential_reference;
        ALTER TABLE asset_sources ADD COLUMN credential_reference TEXT;
        UPDATE asset_sources
        SET credential_reference = (
          SELECT credential_reference
          FROM credential_references_before_migration
          WHERE credential_references_before_migration.id = asset_sources.id
        );
        DROP TABLE credential_references_before_migration;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("2", "schema_version");
    });
  }

  private migrateSchemaVersionTwo(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_source_snapshots
        ADD COLUMN coverage_json TEXT
        CHECK (coverage_json IS NULL OR json_valid(coverage_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("3", "schema_version");
    });
  }

  private migrateSchemaVersionThree(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_sources
        ADD COLUMN display_name TEXT;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("4", "schema_version");
    });
  }

  private migrateSchemaVersionFour(): void {
    this.transaction(() => {
      this.database.exec(`
        INSERT OR IGNORE INTO daily_asset_trend_observations (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        )
        SELECT day, captured_at, complete,
          CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END,
          total_usd, total_cny, NULL, '[]'
        FROM daily_asset_snapshots;
        INSERT OR IGNORE INTO daily_asset_source_trend_observations (
          day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd
        )
        SELECT day, source_id, label, kind, captured_at, complete,
          CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END,
          total_usd, total_cny, NULL
        FROM daily_asset_source_snapshots;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("5", "schema_version");
    });
  }

  private migrateSchemaVersionFive(): void {
    this.transaction(() => {
      const tables = [
        "daily_asset_snapshots",
        "daily_asset_source_snapshots",
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
      ] as const;
      for (const table of tables) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "status")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN status TEXT NOT NULL DEFAULT 'incomplete'
            CHECK (status IN ('complete', 'incomplete', 'expired'));
          `);
        }
      }
      this.database.exec(`
        UPDATE daily_asset_snapshots
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_source_snapshots
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_trend_observations
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_source_trend_observations
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("6", "schema_version");
    });
  }

  private migrateSchemaVersionSix(): void {
    this.transaction(() => {
      const tables = [
        "daily_asset_snapshots",
        "daily_asset_source_snapshots",
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
      ] as const;
      for (const table of tables) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "total_hkd")) {
          this.database.exec(`ALTER TABLE ${table} ADD COLUMN total_hkd TEXT;`);
        }
      }
      for (const table of [
        "daily_asset_snapshots",
        "daily_asset_trend_observations",
      ] as const) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "exchange_rates_json")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN exchange_rates_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(exchange_rates_json));
          `);
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("7", "schema_version");
    });
  }

  private migrateSchemaVersionSeven(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_sources
        ADD COLUMN ignored_asset_keys_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(ignored_asset_keys_json));
        ALTER TABLE asset_sources
        ADD COLUMN included_asset_keys_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(included_asset_keys_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("8", "schema_version");
    });
  }

  private migrateSchemaVersionEight(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "has_manual_record")) {
        this.database.exec(`
          ALTER TABLE asset_sources
          ADD COLUMN has_manual_record INTEGER NOT NULL DEFAULT 1
            CHECK (has_manual_record IN (0, 1));
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("9", "schema_version");
    });
  }

  private migrateSchemaVersionNine(): void {
    this.transaction(() => {
      const rows = this.database
        .prepare(`
          SELECT sources.id, snapshots.total_amount, snapshots.total_currency,
            snapshots.synced_at
          FROM asset_sources AS sources
          JOIN asset_source_snapshots AS snapshots ON snapshots.source_id = sources.id
          WHERE sources.kind = 'manual' AND sources.has_manual_record = 1
        `)
        .all() as SqliteRow[];
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO manual_asset_records (
          source_id, day, amount, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.id as string,
          shanghaiDay(row.synced_at as string),
          row.total_amount as string,
          row.total_currency as string,
          row.synced_at as string,
        );
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("10", "schema_version");
    });
  }

  private migrateSchemaVersionTen(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "manual_asset_class")) {
        this.database.exec(`
          ALTER TABLE asset_sources
          ADD COLUMN manual_asset_class TEXT
            CHECK (
              manual_asset_class IS NULL OR
              manual_asset_class IN ('securities', 'crypto', 'cash', 'other')
            );
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("11", "schema_version");
    });
  }

  private migrateSchemaVersionEleven(): void {
    this.transaction(() => {
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("12", "schema_version");
    });
  }

  private migrateSchemaVersionTwelve(): void {
    this.transaction(() => {
      this.createInvestmentCashflowSchema();
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("13", "schema_version");
    });
  }

  private migrateSchemaVersionThirteen(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_source_snapshots)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "unrecognized_evm_tokens_json")) {
        this.database.exec(`
          ALTER TABLE asset_source_snapshots
          ADD COLUMN unrecognized_evm_tokens_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(unrecognized_evm_tokens_json));
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("14", "schema_version");
    });
  }

  private migrateSchemaVersionFourteen(): void {
    this.transaction(() => {
      for (const table of [
        "daily_asset_source_snapshots",
        "daily_asset_source_trend_observations",
      ] as const) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "asset_class_totals_json")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN asset_class_totals_json TEXT
              CHECK (
                asset_class_totals_json IS NULL OR
                json_valid(asset_class_totals_json)
              );
          `);
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("15", "schema_version");
    });
  }

  private migrateSchemaVersionFifteen(): void {
    this.transaction(() => {
      const manualClasses = new Map(
        (this.database
          .prepare(
            "SELECT id, manual_asset_class FROM asset_sources WHERE kind = 'manual'",
          )
          .all() as Array<SqliteRow>)
          .map((source) => [
            source.id as string,
            source.manual_asset_class as ManualAssetClass | null,
          ]),
      );

      for (const table of [
        "daily_asset_source_snapshots",
        "daily_asset_source_trend_observations",
      ] as const) {
        const rows = this.database
          .prepare(`SELECT * FROM ${table}`)
          .all() as Array<SqliteRow>;
        const updateTable = this.database.prepare(`
          UPDATE ${table}
          SET asset_class_totals_json = ?
          WHERE day = ? AND source_id = ?
        `);
        for (const row of rows) {
          const manualAssetClass = manualClasses.get(row.source_id as string);
          const source = {
            kind: row.kind as AssetSourceSummary["kind"],
            ...(manualAssetClass === null || manualAssetClass === undefined
              ? {}
              : { manualAssetClass }),
          };
          const observation = {
            sourceId: row.source_id as string,
            label: row.label as string,
            kind: row.kind as AssetSourceSummary["kind"],
            capturedAt: row.captured_at as string,
            complete: row.complete === 1,
            status: row.status as DailyAssetSourceSnapshot["status"],
            total: {
              USD: row.total_usd as string | null,
              CNY: row.total_cny as string | null,
              HKD: row.total_hkd as string | null,
            },
          } satisfies DailyAssetSourceSnapshot;
          updateTable.run(
            JSON.stringify(sourceTrendClassTotals(source, observation)),
            row.day,
            row.source_id,
          );
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("16", "schema_version");
    });
  }

  private migrateSchemaVersionSixteen(): void {
    this.transaction(() => {
      this.database.exec(`
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
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("17", "schema_version");
    });
  }

  private migrateSchemaVersionSeventeen(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_source_sync_states ADD COLUMN diagnostic_json TEXT
          CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json));
        ALTER TABLE asset_source_sync_states ADD COLUMN recent_attempts_json TEXT
          NOT NULL DEFAULT '[]' CHECK (json_valid(recent_attempts_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("18", "schema_version");
    });
  }
}
