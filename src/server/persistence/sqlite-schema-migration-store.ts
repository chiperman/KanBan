import { shanghaiDay, sourceTrendClassTotals } from "@/domain/daily-asset-snapshots";
import { sourceInvestmentBookId } from "@/domain/source-investment-book";
import type { SqliteRow } from "@/server/persistence/contracts";
import { SQLITE_SCHEMA_VERSION } from "@/server/persistence/contracts";
import type { DailyAssetSourceSnapshot, ManualAssetClass } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

type Transaction = <T>(operation: () => T) => T;

/** SQLite Schema 版本迁移模块；迁移借用调用方连接与事务。 */
export class SqliteSchemaMigrationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly transaction: Transaction,
    private readonly metadata: (key: string) => string | null,
  ) {}

  migrate(): void {
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
    if (schemaVersion === "20") {
      this.database.prepare("UPDATE schema_metadata SET value = '21' WHERE key = 'schema_version'").run();
      schemaVersion = "21";
    }
    if (schemaVersion === "21") {
      this.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(daily_asset_trend_observations)")
          .all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === "source_scope_json")) {
          this.database.exec(`ALTER TABLE daily_asset_trend_observations
            ADD COLUMN source_scope_json TEXT CHECK (source_scope_json IS NULL OR json_valid(source_scope_json))`);
        }
        // 旧记录没有历史加入日期：冻结已知范围，不将首次采集或当前断开状态当成日期证据。
        this.database.exec(`UPDATE daily_asset_trend_observations AS observation
          SET source_scope_json = (SELECT json_group_array(id) FROM (
            SELECT id FROM asset_sources WHERE kind != 'manual' OR has_manual_record = 1
              OR EXISTS (SELECT 1 FROM manual_asset_records WHERE source_id = asset_sources.id)
            UNION SELECT source_id FROM daily_asset_source_trend_observations WHERE day = observation.day
            ORDER BY 1
          )) WHERE source_scope_json IS NULL`);
        this.database.prepare("UPDATE schema_metadata SET value = '22' WHERE key = 'schema_version'").run();
      });
      schemaVersion = "22";
    }
    if (schemaVersion === "22") {
      this.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(asset_source_snapshots)")
          .all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === "longbridge_valuation_json")) {
          this.database.exec(`ALTER TABLE asset_source_snapshots
            ADD COLUMN longbridge_valuation_json TEXT
            CHECK (longbridge_valuation_json IS NULL OR json_valid(longbridge_valuation_json))`);
        }
        this.database.prepare("UPDATE schema_metadata SET value = '23' WHERE key = 'schema_version'").run();
      });
      schemaVersion = "23";
    }
    if (schemaVersion === "23") {
      this.migrateSchemaVersionTwentyThree();
      schemaVersion = "24";
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
            kind: row.kind as DailyAssetSourceSnapshot["kind"],
            ...(manualAssetClass === null || manualAssetClass === undefined
              ? {}
              : { manualAssetClass }),
          };
          const observation = {
            sourceId: row.source_id as string,
            label: row.label as string,
            kind: row.kind as DailyAssetSourceSnapshot["kind"],
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

  private migrateSchemaVersionTwentyThree(): void {
    this.transaction(() => {
      // Earlier plugin previews used v22 for investment_book_id before primary added source scopes.
      const trendColumns = this.database.prepare("PRAGMA table_info(daily_asset_trend_observations)").all();
      if (!trendColumns.some(column => column.name === "source_scope_json")) {
        this.database.exec(`ALTER TABLE daily_asset_trend_observations
          ADD COLUMN source_scope_json TEXT CHECK (source_scope_json IS NULL OR json_valid(source_scope_json))`);
        this.database.exec(`UPDATE daily_asset_trend_observations AS observation
          SET source_scope_json = (SELECT json_group_array(id) FROM (
            SELECT id FROM asset_sources WHERE kind != 'manual' OR has_manual_record = 1
              OR EXISTS (SELECT 1 FROM manual_asset_records WHERE source_id = asset_sources.id)
            UNION SELECT source_id FROM daily_asset_source_trend_observations WHERE day = observation.day
            ORDER BY 1
          )) WHERE source_scope_json IS NULL`);
      }
      const columns = this.database.prepare("PRAGMA table_info(asset_sources)").all();
      // createSchema may already have created the current table in an empty legacy database.
      if (!columns.some(column => column.name === "investment_book_id")) {
        this.database.exec("ALTER TABLE asset_sources ADD COLUMN investment_book_id TEXT CHECK (investment_book_id IS NULL OR investment_book_id IN ('us-stocks', 'a-shares', 'crypto'))");
        const rows = this.database.prepare("SELECT id, kind, manual_asset_class FROM asset_sources").all();
        const update = this.database.prepare("UPDATE asset_sources SET investment_book_id = ? WHERE id = ?");
        for (const row of rows) update.run(sourceInvestmentBookId({
          kind: row.kind as string,
          manualAssetClass: row.manual_asset_class as ManualAssetClass | undefined,
        }), row.id);
      }
      this.database.prepare("UPDATE schema_metadata SET value = '24' WHERE key = 'schema_version'").run();
    });
  }
}
