import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, } from "node:fs";
import { DashboardSchema } from "./sqlite-schema";

import { buildDailyAssetSnapshot, mergeDailyTrendObservation, shanghaiDay } from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { normalizeIgnoredAssetKeys } from "@/domain/evm-token-preferences";
import { assertManualAssetRecordNotFuture, } from "@/domain/manual-asset-records";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import { type BusinessDataState } from "@/server/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { DashboardDatabase, DashboardState, SqliteRow } from "@/server/persistence/contracts";
import { migrateAssetSource, migrateDailyObservation, parseLegacyDashboardStateSync } from "@/server/persistence/migrations";
import { applyLatestManualAssetRecord, latestManualAssetRecord, manualDailySource } from "@/server/persistence/observations";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import { buildConnectedSource, connectedSourceKind } from "@/server/persistence/source-record";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetSourceSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, FormalDailySettlement, FormalSettlementExecution, ImportedAssetSourceHistoryObservation, InvestmentCashflow, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

const sqlite = process.getBuiltinModule("node:sqlite");
if (sqlite === undefined) {
  throw new Error("当前 Node.js 运行时不支持 node:sqlite");
}
const { DatabaseSync } = sqlite;

/** SQLite 只保存业务数据与不透明凭证引用；秘密正文仍由 SecretStore 持有。 */
export class SqliteDashboardDatabase
  implements DashboardDatabase, InvestmentCashflowStore
{
  private database!: InstanceType<typeof DatabaseSync>;

  constructor(
    private readonly databasePath: string,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {
    try {
      this.database = new DatabaseSync(databasePath);
      chmodSync(databasePath, 0o600);
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      new DashboardSchema(this.database, (operation) => this.transaction(operation), (key) => this.metadata(key)).createSchema();
      this.initializeLegacyData();
      this.assertIntegrity();
      this.hardenDatabaseFiles();
    } catch (error) {
      try {
        this.database?.close();
      } catch {
        // 保留原始启动错误。
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `SQLite 业务数据初始化失败，已停止启动；请保留 ${databasePath} 和旧 JSON 后恢复: ${detail}`,
        { cause: error },
      );
    }
  }

  private initializeLegacyData(): void {
    if (this.metadata("json_import_complete") === "1") return;
    const state = parseLegacyDashboardStateSync(
      this.legacyDashboardPath,
      this.legacyCardsPath,
    );
    this.transaction(() => {
      this.replaceState(state);
      this.backupLegacyDashboard();
      this.database
        .prepare(
          "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
        )
        .run("json_import_complete", "1");
    });
  }

  private backupLegacyDashboard(): void {
    if (!existsSync(this.legacyDashboardPath)) return;
    const backupPath = `${this.legacyDashboardPath}.migration-backup`;
    const source = readFileSync(this.legacyDashboardPath);
    if (existsSync(backupPath)) {
      if (!source.equals(readFileSync(backupPath))) {
        throw new Error(`迁移备份与旧 Dashboard 不一致: ${backupPath}`);
      }
    } else {
      copyFileSync(this.legacyDashboardPath, backupPath);
    }
    chmodSync(backupPath, 0o600);
  }

  private metadata(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM schema_metadata WHERE key = ?")
      .get(key) as SqliteRow | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  async readAssetFullRefreshState(): Promise<{
    attemptedAt: string | null;
    inProgressAt: string | null;
  }> {
    return {
      attemptedAt: this.metadata("asset_full_refresh_attempted_at"),
      inProgressAt: this.metadata("asset_full_refresh_in_progress_at"),
    };
  }

  async startAssetFullRefresh(attemptedAt: string): Promise<void> {
    this.transaction(() => {
      const write = this.database.prepare(
        "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
      );
      write.run("asset_full_refresh_attempted_at", attemptedAt);
      write.run("asset_full_refresh_in_progress_at", attemptedAt);
    });
  }

  async initializeAssetFullRefresh(attemptedAt: string): Promise<boolean> {
    return this.transaction(() =>
      this.database
        .prepare(
          "INSERT OR IGNORE INTO schema_metadata (key, value) VALUES (?, ?)",
        )
        .run("asset_full_refresh_attempted_at", attemptedAt).changes > 0,
    );
  }

  async claimAssetFullRefresh(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    return this.transaction(() => {
      const previousAttemptedAt = this.metadata(
        "asset_full_refresh_attempted_at",
      );
      const inProgressAt = this.metadata(
        "asset_full_refresh_in_progress_at",
      );
      const now = Date.parse(input.attemptedAt);
      const inProgress = inProgressAt === null ? Number.NaN : Date.parse(inProgressAt);
      const inProgressIsCurrent =
        Number.isFinite(inProgress) &&
        Number.isFinite(now) &&
        now - inProgress < input.staleAfterMs;
      if (inProgressAt !== null && inProgressIsCurrent) {
        return "in-progress";
      }

      const previous = previousAttemptedAt === null
        ? Number.NaN
        : Date.parse(previousAttemptedAt);
      if (
        !input.force &&
        Number.isFinite(previous) &&
        Number.isFinite(now) &&
        now - previous < input.intervalMs
      ) {
        return "not-due";
      }

      const write = this.database.prepare(
        "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
      );
      write.run("asset_full_refresh_attempted_at", input.attemptedAt);
      write.run("asset_full_refresh_in_progress_at", input.attemptedAt);
      return "claimed";
    });
  }

  async finishAssetFullRefresh(attemptedAt?: string): Promise<void> {
    this.transaction(() => {
      if (attemptedAt === undefined) {
        this.database
          .prepare("DELETE FROM schema_metadata WHERE key = ?")
          .run("asset_full_refresh_in_progress_at");
        return;
      }
      this.database
        .prepare("DELETE FROM schema_metadata WHERE key = ? AND value = ?")
        .run("asset_full_refresh_in_progress_at", attemptedAt);
    });
  }

  async clearAssetFullRefresh(): Promise<void> {
    this.transaction(() => {
      const remove = this.database.prepare(
        "DELETE FROM schema_metadata WHERE key IN (?, ?)",
      );
      remove.run(
        "asset_full_refresh_attempted_at",
        "asset_full_refresh_in_progress_at",
      );
    });
  }

  private assertIntegrity(): void {
    const result = this.database.prepare("PRAGMA quick_check").get() as
      | SqliteRow
      | undefined;
    if (result === undefined || !Object.values(result).includes("ok")) {
      throw new Error("SQLite 完整性检查失败");
    }
    const foreignKeyViolation = this.database
      .prepare("PRAGMA foreign_key_check")
      .get();
    if (foreignKeyViolation !== undefined) {
      throw new Error("SQLite 外键完整性检查失败");
    }
  }

  private hardenDatabaseFiles(): void {
    for (const filePath of [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
    ]) {
      if (existsSync(/* turbopackIgnore: true */ filePath)) {
        chmodSync(/* turbopackIgnore: true */ filePath, 0o600);
      }
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      this.hardenDatabaseFiles();
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // 优先抛出导致事务失败的原始错误。
      }
      throw error;
    }
  }

  private replaceState(state: DashboardState | BusinessDataState): void {
    this.database.exec(`
      DELETE FROM investment_cashflows;
      DELETE FROM imported_asset_source_history_observations;
      DELETE FROM daily_asset_source_trend_observations;
      DELETE FROM daily_asset_trend_observations;
      DELETE FROM daily_asset_source_snapshots;
      DELETE FROM daily_asset_snapshots;
      DELETE FROM formal_daily_settlements;
      DELETE FROM asset_cards;
      DELETE FROM asset_source_snapshots;
      DELETE FROM asset_source_sync_states;
      DELETE FROM asset_sources;
    `);
    state.assetSources.forEach((source, position) =>
      this.insertSource(source, position),
    );
    state.assetCards.forEach((card, position) => this.insertCard(card, position));
    state.dailyAssetSnapshots.forEach((snapshot) =>
      this.insertDailyBaseline(migrateDailyObservation(snapshot)),
    );
    state.dailyAssetTrendObservations.forEach((observation) =>
      this.upsertDailyTrendObservation(migrateDailyObservation(observation)),
    );
    const importedHistory = "importedAssetSourceHistoryObservations" in state
      ? state.importedAssetSourceHistoryObservations
      : [];
    importedHistory.forEach((observation) =>
      this.insertImportedSourceHistoryObservation(observation),
    );
    const cashflows = "investmentCashflows" in state
      ? (state as { investmentCashflows: InvestmentCashflow[] })
        .investmentCashflows
      : [];
    cashflows.forEach((cashflow) => this.insertInvestmentCashflow(cashflow));
    const manualRecords = "manualAssetRecords" in state
      ? state.manualAssetRecords
      : [];
    for (const record of manualRecords) {
      this.database.prepare(`
        INSERT INTO manual_asset_records (source_id, day, amount, currency, recorded_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.sourceId, record.day, record.amount, record.currency, record.recordedAt);
    }
    const formalSettlements = "formalDailySettlements" in state
      ? state.formalDailySettlements
      : [];
    for (const settlement of formalSettlements) {
      if (!this.insertFormalDailySettlement(settlement)) throw new Error("正式日结锚点重复");
    }
  }

  private insertSource(source: AssetSourceSummary, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, ignored_asset_keys_json, included_asset_keys_json,
          has_manual_record, manual_asset_class, lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        position,
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
      );
    this.upsertSourceDetails(source);
  }

  private upsertSourceDetails(source: AssetSourceSummary): void {
    const sync = normalizeAssetSyncState(source.sync);
    this.database
      .prepare(`
        UPDATE asset_sources
        SET has_manual_record = ?
        WHERE id = ?
      `)
      .run(
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.id,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_snapshots (
          source_id, total_amount, total_currency, holdings_json,
          unrecognized_evm_tokens_json, exchange_rates_json, coverage_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.snapshot.total.amount,
        source.snapshot.total.currency,
        JSON.stringify(source.snapshot.holdings),
        JSON.stringify(source.snapshot.unrecognizedEvmTokens ?? []),
        JSON.stringify(source.snapshot.exchangeRates),
        source.snapshot.coverage === undefined
          ? null
          : JSON.stringify(source.snapshot.coverage),
        source.snapshot.syncedAt,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_sync_states (
          source_id, status, last_successful_at, last_attempt_at, error, failed_mode,
          diagnostic_json, recent_attempts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.sync.status,
        source.sync.lastSuccessfulAt,
        source.sync.lastAttemptAt,
        source.sync.error,
        source.sync.failedMode ?? null,
        sync.diagnostic === undefined || sync.diagnostic === null
          ? null : JSON.stringify(sync.diagnostic),
        JSON.stringify(sync.recentAttempts ?? []),
      );
  }

  private insertCard(card: Card, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_cards (
          id, position, title, body, source_id, hidden, span, starts_new_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        card.id,
        position,
        card.title,
        card.body,
        card.sourceId ?? null,
        card.hidden === undefined ? null : Number(card.hidden),
        card.span,
        card.startsNewRow === undefined ? null : Number(card.startsNewRow),
      );
  }

  private insertInvestmentCashflow(cashflow: InvestmentCashflow): void {
    this.database
      .prepare(`
        INSERT INTO investment_cashflows (
          id, kind, occurred_at, amount, currency, note,
          amount_usd, amount_cny, amount_hkd, exchange_rates_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        cashflow.id,
        cashflow.kind,
        cashflow.occurredAt,
        cashflow.amount,
        cashflow.currency,
        cashflow.note,
        cashflow.amounts.USD,
        cashflow.amounts.CNY,
        cashflow.amounts.HKD,
        JSON.stringify(cashflow.exchangeRates),
        cashflow.createdAt,
        cashflow.updatedAt,
      );
  }

  private insertDailyBaseline(snapshot: DailyAssetSnapshot): boolean {
    const inserted = this.database
      .prepare(`
        INSERT OR IGNORE INTO daily_asset_snapshots (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      ).changes > 0;
    if (!inserted) return false;
    this.insertDailyBaselineSources(snapshot);
    return true;
  }

  private insertDailyBaselineSources(snapshot: DailyAssetSnapshot): void {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO daily_asset_source_snapshots (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
  }

  private replaceExpiredDailyBaseline(snapshot: DailyAssetSnapshot): void {
    this.database
      .prepare(`
        UPDATE daily_asset_snapshots
        SET captured_at = ?, complete = ?, status = ?, total_usd = ?, total_cny = ?,
          total_hkd = ?, exchange_rates_json = ?
        WHERE day = ?
      `)
      .run(
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
        snapshot.day,
      );
    this.database
      .prepare("DELETE FROM daily_asset_source_snapshots WHERE day = ?")
      .run(snapshot.day);
    this.insertDailyBaselineSources(snapshot);
  }

  private upsertDailyTrendObservation(
    snapshot: DailyAssetTrendObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO daily_asset_trend_observations (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          exchange_rates_json = excluded.exchange_rates_json
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      );
    const statement = this.database.prepare(`
      INSERT INTO daily_asset_source_trend_observations (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, source_id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        captured_at = excluded.captured_at,
        complete = excluded.complete,
        status = excluded.status,
        total_usd = excluded.total_usd,
        total_cny = excluded.total_cny,
        total_hkd = excluded.total_hkd,
        asset_class_totals_json = excluded.asset_class_totals_json
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
    this.recalculateDailyTrendObservation(snapshot.day);
  }

  private upsertDailySourceObservation(
    table:
      | "daily_asset_source_snapshots"
      | "daily_asset_source_trend_observations",
    day: string,
    source: DailyAssetSourceSnapshot,
  ): void {
    this.database
      .prepare(`
        INSERT INTO ${table} (
          day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, source_id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          asset_class_totals_json = excluded.asset_class_totals_json
      `)
      .run(
        day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
  }

  private insertImportedSourceHistoryObservation(
    observation: ImportedAssetSourceHistoryObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO imported_asset_source_history_observations (
          source_id, day, label, kind, captured_at, complete, status,
          total_usd, total_cny, total_hkd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        observation.sourceId,
        observation.day,
        observation.label,
        observation.kind,
        observation.capturedAt,
        Number(observation.complete),
        observation.status ?? (observation.complete ? "complete" : "incomplete"),
        observation.total.USD,
        observation.total.CNY,
        observation.total.HKD ?? null,
      );
  }

  /**
   * 手工记录是按上海自然日覆盖写入：同一来源当天只有一条，编辑会替换该来源的日值，
   * 而不会覆盖同日外部来源的观测。
   */
  private recordManualDailyObservation(
    source: AssetSourceSummary,
    record: ManualAssetRecord,
    capturedAt: string,
  ): void {
    const isCurrentDay = record.day === shanghaiDay(capturedAt);
    const currentObservation = isCurrentDay
      ? buildDailyAssetSnapshot(this.listSourcesSync(), capturedAt)
      : null;
    const manualSource = currentObservation?.sources.find(
      (item) => item.sourceId === source.id,
    ) ?? manualDailySource(source, record);

    const hasBaseline = this.database
      .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasBaseline && currentObservation !== null) {
      this.insertDailyBaseline(currentObservation);
    }

    const hasTrend = this.database
      .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasTrend && currentObservation !== null) {
      this.upsertDailyTrendObservation(currentObservation);
    } else if (!hasTrend) {
      this.database
        .prepare(`
          INSERT INTO daily_asset_trend_observations (
            day, captured_at, complete, status, total_usd, total_cny, total_hkd,
            exchange_rates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.day,
          manualSource.capturedAt,
          Number(manualSource.complete),
          manualSource.status ?? "incomplete",
          manualSource.total.USD,
          manualSource.total.CNY,
          manualSource.total.HKD ?? null,
          "[]",
        );
      this.upsertDailySourceObservation(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
    } else {
      this.upsertDailySourceObservation(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
      this.recalculateDailyTrendObservation(record.day);
    }
  }

  private recalculateDailySnapshot(
    day: string,
    tables: {
      snapshot: "daily_asset_snapshots" | "daily_asset_trend_observations";
      source: "daily_asset_source_snapshots" | "daily_asset_source_trend_observations";
    },
  ): void {
    const sources = this.dailySourceRows(day, tables.source);
    if (sources.length === 0) {
      this.database.prepare(`DELETE FROM ${tables.snapshot} WHERE day = ?`).run(day);
      return;
    }
    const totals = (column: "total_usd" | "total_cny" | "total_hkd") => {
      const values = sources.flatMap((source) =>
        typeof source[column] === "string" ? [source[column]] : [],
      );
      return values.length > 0 ? decimalAdd(...values) : null;
    };
    const totalUsd = totals("total_usd");
    const complete =
      totalUsd !== null &&
      totals("total_hkd") !== null &&
      sources.every((source) => source.complete === 1);
    const status = sources.some((source) => source.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete";
    this.database
      .prepare(`
        UPDATE ${tables.snapshot}
        SET complete = ?, status = ?, total_usd = ?, total_cny = ?, total_hkd = ?
        WHERE day = ?
      `)
      .run(
        Number(complete),
        status,
        totalUsd,
        totals("total_cny"),
        totals("total_hkd"),
        day,
      );
  }

  private recalculateDailyTrendObservation(day: string): void {
    this.recalculateDailySnapshot(day, {
      snapshot: "daily_asset_trend_observations",
      source: "daily_asset_source_trend_observations",
    });
  }

  private dailySourceRows(
    day: string,
    table = "daily_asset_source_snapshots",
  ): SqliteRow[] {
    return this.database
      .prepare(`
        SELECT source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        FROM ${table}
        WHERE day = ?
        ORDER BY rowid
      `)
      .all(day) as SqliteRow[];
  }

  private compactPositions(table: "asset_sources" | "asset_cards"): void {
    const rows = this.database
      .prepare(`SELECT id, position FROM ${table} ORDER BY position`)
      .all() as SqliteRow[];
    const update = this.database.prepare(
      `UPDATE ${table} SET position = ? WHERE id = ?`,
    );
    rows.forEach((row, position) => {
      if (row.position !== position) update.run(position, row.id as string);
    });
  }

  private listSourcesSync(detailSourceId?: string): AssetSourceSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM asset_sources ORDER BY position")
      .all() as SqliteRow[];
    // Retain global rates/registration metadata without decoding unrelated holdings.
    const snapshots = this.database.prepare(detailSourceId === undefined
      ? "SELECT * FROM asset_source_snapshots"
      : "SELECT source_id, total_amount, total_currency, synced_at, exchange_rates_json, CASE WHEN source_id = ? THEN holdings_json ELSE '[]' END AS holdings_json, CASE WHEN source_id = ? THEN unrecognized_evm_tokens_json ELSE '[]' END AS unrecognized_evm_tokens_json, CASE WHEN source_id = ? THEN coverage_json ELSE NULL END AS coverage_json FROM asset_source_snapshots")
      .all(...(detailSourceId === undefined ? [] : [detailSourceId, detailSourceId, detailSourceId])) as SqliteRow[];
    const snapshotMap = new Map(snapshots.map((row) => [row.source_id, row]));
    const syncMap = new Map((this.database.prepare("SELECT * FROM asset_source_sync_states").all() as SqliteRow[]).map((row) => [row.source_id, row]));
    return rows.map((row) => {
      const snapshot = snapshotMap.get(row.id)!;
      const sync = syncMap.get(row.id)!;
      const unrecognizedEvmTokens = JSON.parse(
        (snapshot.unrecognized_evm_tokens_json as string | null) ?? "[]",
      );
      return migrateAssetSource({
        id: row.id as string,
        kind: row.kind as string,
        label: row.label as string,
        ...(typeof row.display_name === "string"
          ? { displayName: row.display_name }
          : {}),
        accountId: row.account_id as string,
        permissions: JSON.parse(row.permissions_json as string),
        credentialReference:
          typeof row.credential_reference === "string"
            ? row.credential_reference
            : null,
        ignoredAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.ignored_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        includedAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.included_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        ...(row.kind === "manual"
          ? {
              hasManualRecord: row.has_manual_record !== 0,
              ...(typeof row.manual_asset_class === "string"
                ? {
                    manualAssetClass:
                      row.manual_asset_class as ManualAssetClass,
                  }
                : {}),
            }
          : {}),
        snapshot: {
          total: {
            amount: snapshot.total_amount as string,
            currency: snapshot.total_currency as string,
          },
          holdings: JSON.parse(snapshot.holdings_json as string),
          ...(unrecognizedEvmTokens.length === 0
            ? {}
            : { unrecognizedEvmTokens }),
          exchangeRates: JSON.parse(snapshot.exchange_rates_json as string),
          ...(snapshot.coverage_json === null
            ? {}
            : {
                coverage: JSON.parse(snapshot.coverage_json as string),
              }),
          syncedAt: snapshot.synced_at as string,
        },
        sync: normalizeAssetSyncState({
          status: sync.status as "current" | "expired",
          lastSuccessfulAt: sync.last_successful_at as string,
          lastAttemptAt: sync.last_attempt_at as string,
          error: sync.error as string | null,
          ...(sync.failed_mode === null
            ? {}
            : { failedMode: sync.failed_mode as "all" | "prices" | "holdings" }),
          ...(sync.diagnostic_json === null
            ? {}
            : { diagnostic: JSON.parse(sync.diagnostic_json as string) }),
          ...(sync.recent_attempts_json === "[]" ? {} : {
            recentAttempts: JSON.parse((sync.recent_attempts_json as string | null) ?? "[]"),
          }),
        }),
        ...(row.lifecycle === null
          ? {}
          : { lifecycle: row.lifecycle as "connected" | "disconnected" }),
      });
    });
  }

  private listManualAssetRecordsSync(sourceId?: string): ManualAssetRecord[] {
    const rows = this.database
      .prepare(`
        SELECT source_id, day, amount, currency, recorded_at
        FROM manual_asset_records
        ${sourceId === undefined ? "" : "WHERE source_id = ?"}
        ORDER BY source_id, day DESC
      `)
      .all(...(sourceId === undefined ? [] : [sourceId])) as SqliteRow[];
    return rows.map((row) => ({
      sourceId: row.source_id as string,
      day: row.day as string,
      amount: row.amount as string,
      currency: row.currency as ManualAssetRecord["currency"],
      recordedAt: row.recorded_at as string,
    }));
  }

  private listInvestmentCashflowsSync(): InvestmentCashflow[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM investment_cashflows
        ORDER BY occurred_at DESC, created_at DESC, id DESC
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as InvestmentCashflow["kind"],
      occurredAt: row.occurred_at as string,
      amount: row.amount as string,
      currency: row.currency as InvestmentCashflow["currency"],
      note: row.note as string | null,
      amounts: {
        USD: row.amount_usd as string | null,
        CNY: row.amount_cny as string | null,
        HKD: row.amount_hkd as string | null,
      },
      exchangeRates: JSON.parse(row.exchange_rates_json as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  private listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    return this.listDailyObservationsSync(
      "daily_asset_snapshots",
      "daily_asset_source_snapshots",
    );
  }

  private listDailyAssetTrendObservationsSync(): DailyAssetTrendObservation[] {
    return this.listDailyObservationsSync(
      "daily_asset_trend_observations",
      "daily_asset_source_trend_observations",
    );
  }

  private listImportedSourceHistoryObservationsSync():
    ImportedAssetSourceHistoryObservation[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM imported_asset_source_history_observations
        ORDER BY day, source_id
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      day: row.day as string,
      sourceId: row.source_id as string,
      label: row.label as string,
      kind: row.kind as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as ImportedAssetSourceHistoryObservation["status"],
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
    }));
  }

  private listDailyObservationsSync(
    snapshotTable: "daily_asset_snapshots" | "daily_asset_trend_observations",
    sourceTable:
      | "daily_asset_source_snapshots"
      | "daily_asset_source_trend_observations",
    day?: string,
    query?: { sourceId: string; from?: string; to?: string },
  ): DailyAssetSnapshot[] {
    const conditions: string[] = [];
    const args: string[] = [];
    if (day !== undefined) { conditions.push("day = ?"); args.push(day); }
    if (query?.from) { conditions.push("day >= ?"); args.push(query.from); }
    if (query?.to) { conditions.push("day <= ?"); args.push(query.to); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const rows = this.database.prepare("SELECT * FROM " + snapshotTable + where + " ORDER BY day").all(...args) as SqliteRow[];
    const sourceWhere = query ? (where ? where + " AND " : " WHERE ") + "source_id = ?" : where;
    const children = this.database.prepare("SELECT * FROM " + sourceTable + sourceWhere + " ORDER BY day, source_id")
      .all(...args, ...(query ? [query.sourceId] : [])) as SqliteRow[];
    const byDay = new Map<string, SqliteRow[]>();
    for (const child of children) {
      const items = byDay.get(child.day as string) ?? [];
      items.push(child); byDay.set(child.day as string, items);
    }
    return rows.map((row) => migrateDailyObservation({
      day: row.day as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as "complete" | "incomplete" | "expired",
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
      exchangeRates: JSON.parse(
        (row.exchange_rates_json as string | null) ?? "[]",
      ),
      sources: (byDay.get(row.day as string) ?? []).map((source) => ({
        sourceId: source.source_id as string,
        label: source.label as string,
        kind: source.kind as string,
        capturedAt: source.captured_at as string,
        complete: source.complete === 1,
        status: source.status as "complete" | "incomplete" | "expired",
        total: {
          USD: source.total_usd as string | null,
          CNY: source.total_cny as string | null,
          HKD: source.total_hkd as string | null,
        },
        ...(source.asset_class_totals_json === null
          ? {}
          : {
              assetClassTotals: JSON.parse(
                source.asset_class_totals_json as string,
              ),
            }),
      })),
    }));
  }

  async readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    const first = this.database.prepare("SELECT MIN(day) AS day FROM daily_asset_source_trend_observations WHERE source_id = ?").get(query.sourceId) as SqliteRow;
    return {
      sources: this.listSourcesSync(query.sourceId),
      manualRecords: this.listManualAssetRecordsSync(query.sourceId),
      history: this.listDailyObservationsSync("daily_asset_trend_observations", "daily_asset_source_trend_observations", undefined, query),
      firstDay: typeof first.day === "string" ? first.day : undefined,
    };
  }

  async listAssetCards(): Promise<Card[]> {
    const rows = this.database
      .prepare("SELECT * FROM asset_cards ORDER BY position")
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: "asset",
      title: row.title as string,
      body: row.body as string,
      span: row.span as 1 | 2 | 3,
      ...(row.source_id === null ? {} : { sourceId: row.source_id as string }),
      ...(row.hidden === null ? {} : { hidden: row.hidden === 1 }),
      ...(row.starts_new_row === null
        ? {}
        : { startsNewRow: row.starts_new_row === 1 }),
    }));
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    this.transaction(() => {
      this.database.exec("DELETE FROM asset_cards");
      cards.forEach((card, position) => this.insertCard(card, position));
    });
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    return this.listSourcesSync();
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    this.transaction(() => {
      this.database.exec(`
        DELETE FROM formal_daily_settlements;
        DELETE FROM asset_source_snapshots;
        DELETE FROM asset_source_sync_states;
        DELETE FROM asset_sources;
      `);
      sources.forEach((source, position) => this.insertSource(source, position));
    });
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT id FROM asset_sources WHERE id = ?")
        .get(source.id);
      if (existing === undefined) return;
      this.database
        .prepare(`
          UPDATE asset_sources
          SET kind = ?, label = ?, display_name = ?, account_id = ?,
              permissions_json = ?, credential_reference = ?,
              ignored_asset_keys_json = ?, included_asset_keys_json = ?,
              manual_asset_class = ?, lifecycle = ?
          WHERE id = ?
        `)
        .run(
          source.kind,
          source.label,
          source.displayName ?? null,
          source.accountId,
          JSON.stringify(source.permissions),
          source.credentialReference,
          JSON.stringify(source.ignoredAssetKeys ?? []),
          JSON.stringify(source.includedAssetKeys ?? []),
          source.kind === "manual" ? source.manualAssetClass ?? null : null,
          source.lifecycle ?? null,
          source.id,
        );
      this.upsertSourceDetails(source);
    });
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    return this.listDailyAssetSnapshotsSync();
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    return this.listDailyAssetTrendObservationsSync();
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return this.listImportedSourceHistoryObservationsSync();
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    return this.listManualAssetRecordsSync();
  }

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return this.listInvestmentCashflowsSync();
  }

  async createInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.transaction(() => {
      this.insertInvestmentCashflow(cashflow);
    });
  }

  async updateInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare(`
          UPDATE investment_cashflows
          SET kind = ?, occurred_at = ?, amount = ?, currency = ?, note = ?,
              amount_usd = ?, amount_cny = ?, amount_hkd = ?,
              exchange_rates_json = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          cashflow.kind,
          cashflow.occurredAt,
          cashflow.amount,
          cashflow.currency,
          cashflow.note,
          cashflow.amounts.USD,
          cashflow.amounts.CNY,
          cashflow.amounts.HKD,
          JSON.stringify(cashflow.exchangeRates),
          cashflow.updatedAt,
          cashflow.id,
        );
      if (result.changes !== 1) throw new Error("资金记录不存在");
    });
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM investment_cashflows WHERE id = ?")
        .run(id);
      if (result.changes !== 1) throw new Error("资金记录不存在");
    });
  }

  async latestFormalSettlementExecution(): Promise<FormalSettlementExecution | null> {
    const row = this.database.prepare(
      "SELECT payload_json FROM formal_settlement_execution WHERE id = 1",
    ).get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as FormalSettlementExecution : null;
  }

  async recordFormalSettlementExecution(execution: FormalSettlementExecution): Promise<void> {
    this.database.prepare(
      "INSERT INTO formal_settlement_execution (id, started_at, payload_json) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, payload_json = excluded.payload_json " +
      "WHERE excluded.started_at >= formal_settlement_execution.started_at",
    ).run(execution.startedAt, JSON.stringify(execution));
  }

  async listFormalDailySettlements(): Promise<FormalDailySettlement[]> {
    const rows = this.database
      .prepare(`
        SELECT * FROM formal_daily_settlements
        ORDER BY scheduled_close_at DESC, anchor_key DESC
      `)
      .all() as SqliteRow[];
    const grouped = (table: "formal_daily_settlement_sources" | "formal_daily_settlement_holdings") => {
      const groups = new Map<string, SqliteRow[]>();
      for (const child of this.database.prepare("SELECT * FROM " + table + " ORDER BY rowid").all() as SqliteRow[]) {
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

  private insertFormalDailySettlement(
    settlement: FormalDailySettlement,
  ): boolean {
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

  async recordFormalDailySettlementIfAbsent(
    settlement: FormalDailySettlement,
  ): Promise<boolean> {
    return this.transaction(() => this.insertFormalDailySettlement(settlement));
  }

  async validateBusinessData(state: BusinessDataState): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.replaceState(state);
      this.assertIntegrity();
      this.database.exec("ROLLBACK");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // 优先抛出备份验证错误。
      }
      throw error;
    }
  }

  async replaceBusinessData(state: BusinessDataState): Promise<void> {
    this.transaction(() => {
      this.replaceState(state);
      this.assertIntegrity();
    });
  }

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.transaction(() => {
      const inserted = this.insertDailyBaseline(snapshot);
      if (inserted) this.upsertDailyTrendObservation(snapshot);
      return inserted;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    this.transaction(() => {
      const baseline = this.database
        .prepare("SELECT status FROM daily_asset_snapshots WHERE day = ?")
        .get(snapshot.day) as { status: "complete" | "incomplete" | "expired" }
          | undefined;
      if (baseline === undefined && createBaseline) {
        this.insertDailyBaseline(snapshot);
      } else if (
        createBaseline &&
        baseline !== undefined &&
        baseline.status === "expired"
      ) {
        this.replaceExpiredDailyBaseline(snapshot);
      }
      const hasTrend = this.database
        .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
        .get(snapshot.day) !== undefined;
      const existing = hasTrend
        ? this.listDailyObservationsSync(
            "daily_asset_trend_observations", "daily_asset_source_trend_observations", snapshot.day,
          )[0]
        : undefined;
      this.upsertDailyTrendObservation(
        existing
          ? mergeDailyTrendObservation(existing, snapshot, !createBaseline)
          : snapshot,
      );
    });
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    this.transaction(() => {
      if (
        this.database
          .prepare("SELECT id FROM asset_sources WHERE id = ?")
          .get(sourceId) === undefined
      ) {
        throw new Error("资产来源不存在");
      }
      const result = this.database
        .prepare("UPDATE asset_cards SET hidden = ? WHERE source_id = ?")
        .run(Number(hidden), sourceId);
      if (result.changes === 0) throw new Error("资产卡片不存在");
    });
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare("UPDATE asset_sources SET display_name = ? WHERE id = ?")
        .run(displayName, sourceId);
      if (result.changes === 0) throw new Error("资产来源不存在");
    });
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    this.transaction(() => {
      const source = this.database
        .prepare("SELECT kind FROM asset_sources WHERE id = ?")
        .get(sourceId) as { kind: string } | undefined;
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产来源可以设置资产类别");
      }
      this.database
        .prepare(
          "UPDATE asset_sources SET manual_asset_class = ? WHERE id = ?",
        )
        .run(assetClass, sourceId);
    });
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE asset_sources
           SET ignored_asset_keys_json = ?, included_asset_keys_json = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(ignoredAssetKeys),
          JSON.stringify(includedAssetKeys),
          sourceId,
        );
      if (result.changes === 0) throw new Error("资产来源不存在");
    });
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      const sourceId = randomUUID();
      const source: AssetSourceSummary = {
        id: sourceId,
        kind: "manual",
        label: input.label,
        hasManualRecord: false,
        accountId: `manual:${sourceId}`,
        permissions: [],
        credentialReference: null,
        snapshot: {
          total: { amount: "0", currency: "CNY" },
          holdings: [],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      };
      const sourcePosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
      ).count as number;
      const cardPosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
      ).count as number;
      this.insertSource(source, sourcePosition);
      this.insertCard(
        {
          id: randomUUID(),
          kind: "asset",
          title: "手工资产记录",
          body: "每日记录资产总额",
          sourceId,
          span: 1,
        },
        cardPosition,
      );
    });
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
      const source = this.listSourcesSync().find(
        (item) => item.id === sourceId,
      );
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以编辑今日总额");
      }
      this.database
        .prepare(`
          INSERT INTO manual_asset_records (
            source_id, day, amount, currency, recorded_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source_id, day) DO UPDATE SET
            amount = excluded.amount,
            currency = excluded.currency,
            recorded_at = excluded.recorded_at
        `)
        .run(sourceId, input.day, input.amount, input.currency, capturedAt);
      const record = this.listManualAssetRecordsSync().find(
        (item) => item.sourceId === sourceId && item.day === input.day,
      );
      if (!record) throw new Error("手工资产记录保存失败");
      const latest = latestManualAssetRecord(
        this.listManualAssetRecordsSync().filter(
          (item) => item.sourceId === sourceId,
        ),
      );
      const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
      this.upsertSourceDetails(updated);
      this.recordManualDailyObservation(updated, record, capturedAt);
    });
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      const source = this.listSourcesSync().find(
        (item) => item.id === sourceId,
      );
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以删除");
      }
      const result = this.database
        .prepare(
          "DELETE FROM manual_asset_records WHERE source_id = ? AND day = ?",
        )
        .run(sourceId, day);
      if (result.changes === 0) throw new Error("指定日期没有手工资产记录");
      const latest = latestManualAssetRecord(
        this.listManualAssetRecordsSync().filter(
          (item) => item.sourceId === sourceId,
        ),
      );
      this.upsertSourceDetails(
        applyLatestManualAssetRecord(source, latest, capturedAt),
      );
      for (const [snapshot, sourceTable] of [
        ["daily_asset_snapshots", "daily_asset_source_snapshots"],
        ["daily_asset_trend_observations", "daily_asset_source_trend_observations"],
      ] as const) {
        this.database
          .prepare(`DELETE FROM ${sourceTable} WHERE day = ? AND source_id = ?`)
          .run(day, sourceId);
        this.recalculateDailySnapshot(day, {
          snapshot,
          source: sourceTable,
        });
      }
    });
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => {
      const source = this.database
        .prepare(
          "SELECT kind, credential_reference FROM asset_sources WHERE id = ?",
        )
        .get(sourceId) as SqliteRow | undefined;
      if (source === undefined) throw new Error("资产来源不存在");
      if (source.kind === "manual") {
        throw new Error("手工资产记录不支持断开");
      }
      this.database
        .prepare("UPDATE asset_sources SET lifecycle = 'disconnected' WHERE id = ?")
        .run(sourceId);
      return typeof source.credential_reference === "string"
        ? source.credential_reference
        : null;
    });
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.transaction(() => {
      const source = this.database
        .prepare(
          "SELECT credential_reference FROM asset_sources WHERE id = ?",
        )
        .get(sourceId) as SqliteRow | undefined;
      if (source === undefined) throw new Error("资产来源不存在");
      const baselineDays = this.database
        .prepare(
          "SELECT day FROM daily_asset_source_snapshots WHERE source_id = ?",
        )
        .all(sourceId) as SqliteRow[];
      const trendDays = this.database
        .prepare(
          "SELECT day FROM daily_asset_source_trend_observations WHERE source_id = ?",
        )
        .all(sourceId) as SqliteRow[];
      this.database
        .prepare(`
          DELETE FROM formal_daily_settlements
          WHERE anchor_key IN (
            SELECT anchor_key
            FROM formal_daily_settlement_sources
            WHERE source_id = ?
          )
        `)
        .run(sourceId);
      this.database
        .prepare("DELETE FROM asset_cards WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_snapshots WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_trend_observations WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM imported_asset_source_history_observations WHERE source_id = ?")
        .run(sourceId);
      this.database.prepare("DELETE FROM asset_sources WHERE id = ?").run(sourceId);
      this.compactPositions("asset_sources");
      this.compactPositions("asset_cards");
      for (const { day } of baselineDays) {
        this.recalculateDailySnapshot(day as string, {
          snapshot: "daily_asset_snapshots",
          source: "daily_asset_source_snapshots",
        });
      }
      for (const { day } of trendDays) this.recalculateDailyTrendObservation(day as string);
      return typeof source.credential_reference === "string"
        ? source.credential_reference
        : null;
    });
  }

  async connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("longbridge", result, credentialReference, capturedAt);
  }

  async connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("binance", result, credentialReference, capturedAt);
  }

  async reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<string | null> {
    return this.transaction(() => {
      const source = this.listSourcesSync().find(({ id }) => id === sourceId);
      const kind = connectedSourceKind(sourceKind, result);
      if (!source || source.kind !== kind) {
        throw new Error("资产来源不存在或类型不匹配");
      }
      if (source.accountId !== result.account.id) {
        throw new Error("新授权对应的账户与原来源不一致");
      }
      const updated: AssetSourceSummary = {
        ...source,
        label: result.account.label,
        accountId: result.account.id,
        permissions: result.permissions,
        credentialReference,
        snapshot: result.snapshot,
        lifecycle: "connected",
        sync: {
          status: "current",
          lastSuccessfulAt: result.snapshot.syncedAt,
          lastAttemptAt: result.snapshot.syncedAt,
          error: null,
        },
      };
      this.database
        .prepare(`
          UPDATE asset_sources
          SET label = ?, account_id = ?, permissions_json = ?,
              credential_reference = ?, lifecycle = ?
          WHERE id = ?
        `)
        .run(
          updated.label,
          updated.accountId,
          JSON.stringify(updated.permissions),
          updated.credentialReference,
          "connected",
          updated.id,
      );
      this.upsertSourceDetails(updated);
      return source.credentialReference;
    });
  }

  async connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("okx", result, credentialReference, capturedAt);
  }

  async connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("bitget", result, credentialReference, capturedAt);
  }

  async connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("bit", result, credentialReference, capturedAt);
  }

  async connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("evm", result, credentialReference, capturedAt);
  }

  private connectAssetSource(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): void {
    this.transaction(() => {
      const isFirstAutomaticSource = this.database
        .prepare("SELECT 1 FROM asset_sources WHERE kind <> 'manual' LIMIT 1")
        .get() === undefined;
      const connected = buildConnectedSource(
        sourceKind,
        result,
        credentialReference,
      );
      const sourcePosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
      ).count as number;
      const cardPosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
      ).count as number;
      this.insertSource(connected.source, sourcePosition);
      this.insertCard(connected.card, cardPosition);
      const observation = buildDailyAssetSnapshot(
        this.listSourcesSync(),
        capturedAt,
      );
      if (isFirstAutomaticSource && observation.complete) {
        const hasBaseline = this.database
          .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
          .get(observation.day) !== undefined;
        if (!hasBaseline) this.insertDailyBaseline(observation);
        this.upsertDailyTrendObservation(observation);
      }
    });
  }
}
