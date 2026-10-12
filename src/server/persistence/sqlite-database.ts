import { randomUUID } from "node:crypto";
import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { chmodSync, copyFileSync, existsSync, readFileSync, } from "node:fs";
import { DashboardSchema } from "./sqlite-schema";
import { SqliteDashboardReadModel } from "./sqlite-read-model";
import { SqliteFormalSettlementStore } from "./sqlite-formal-settlements";

import { buildDailyAssetSnapshot, mergeDailyTrendObservation, shanghaiDay } from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { assertManualAssetRecordNotFuture, } from "@/domain/manual-asset-records";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import { type BusinessDataState } from "@/server/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { DashboardDatabase, DashboardState, SqliteRow } from "@/server/persistence/contracts";
import { migrateDailyObservation, parseLegacyDashboardStateSync } from "@/server/persistence/migrations";
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
  private readModel!: SqliteDashboardReadModel;
  private formalSettlements!: SqliteFormalSettlementStore;

  constructor(
    private readonly databasePath: string,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {
    try {
      this.database = new DatabaseSync(databasePath);
      this.readModel = new SqliteDashboardReadModel(this.database);
      this.formalSettlements = new SqliteFormalSettlementStore(this.database);
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
    if ("sourceInvestmentHistories" in state) {
      for (const history of state.sourceInvestmentHistories ?? []) this.writeSourceInvestmentHistory(history);
    }
    if ("sourceInvestmentRecords" in state) {
      for (const record of state.sourceInvestmentRecords ?? []) this.insertSourceInvestmentRecord(record);
    }
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
      if (!this.formalSettlements.insert(settlement)) throw new Error("正式日结锚点重复");
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
    this.database
      .prepare("DELETE FROM daily_asset_source_trend_observations WHERE day = ?")
      .run(snapshot.day);
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
      ? buildDailyAssetSnapshot(this.readModel.listSourcesSync(), capturedAt)
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

  async readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    return this.readModel.readSourceDetail(query);
  }

  async listSourceInvestmentRecords(sourceId?: string): Promise<SourceInvestmentRecord[]> {
    return this.readModel.listSourceInvestmentRecordsSync(sourceId);
  }

  private insertSourceInvestmentRecord(record: SourceInvestmentRecord): void {
    this.database.prepare("INSERT INTO source_investment_records (id, source_id, day, kind, amount, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.sourceId, record.day, record.kind, record.amount, record.currency, record.recordedAt);
  }

  async saveSourceInvestmentRecord(sourceId: string, input: SourceInvestmentRecordInput, capturedAt: string): Promise<void> {
    const record = parseSourceInvestmentRecordInput(input, capturedAt);
    this.transaction(() => {
      if (!this.database.prepare("SELECT id FROM asset_sources WHERE id = ?").get(sourceId)) throw new InvalidSourceInvestmentRecordError("资产来源不存在");
      const existing = this.readModel.listSourceInvestmentRecordsSync(sourceId);
      const other = this.database.prepare("SELECT source_id FROM source_investment_records WHERE id = ?").get(record.id) as { source_id: string } | undefined;
      if (other && other.source_id !== sourceId) throw new InvalidSourceInvestmentRecordError("记录 ID 属于其他来源");
      const unchanged = existing.find(row => row.id === record.id);
      if (unchanged && ["day", "kind", "amount", "currency"].every(key => unchanged[key as keyof SourceInvestmentRecord] === record[key as keyof SourceInvestmentRecordInput])) return;
      const remaining = existing.filter(row => row.id !== record.id);
      const historyRow = this.database.prepare("SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?").get(sourceId) as { payload_json: string } | undefined;
      const history = historyRow ? parseSourceInvestmentHistory(JSON.parse(historyRow.payload_json)) : null;
      if (history && record.currency !== history.currency) throw new InvalidSourceInvestmentRecordError("来源投资记录币种与导入历史不一致");
      if (history && record.day < history.openingInvestment.day) throw new InvalidSourceInvestmentRecordError("记录不能早于导入历史期初日期");
      if (remaining.some(row => row.currency !== record.currency)) throw new InvalidSourceInvestmentRecordError("同一来源投资记录币种必须一致");
      if (record.kind === "opening") {
        if (history) throw new InvalidSourceInvestmentRecordError("已有导入历史，不能新增期初本金");
        if (remaining.some(row => row.kind === "opening" || row.day < record.day)) throw new InvalidSourceInvestmentRecordError("期初本金必须唯一且不晚于其他记录");
      } else if (remaining.some(row => row.kind === "opening" && row.day > record.day)) {
        throw new InvalidSourceInvestmentRecordError("记录不能早于期初本金");
      }
      if (record.kind === "valuation" && remaining.some(row => row.kind === "valuation" && row.day === record.day)) throw new InvalidSourceInvestmentRecordError("同日资产金额只能记录一次");
      this.database.prepare("INSERT INTO source_investment_records (id, source_id, day, kind, amount, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, kind = excluded.kind, amount = excluded.amount, currency = excluded.currency, recorded_at = excluded.recorded_at")
        .run(record.id, sourceId, record.day, record.kind, record.amount, record.currency, capturedAt);
    });
  }

  async deleteSourceInvestmentRecord(sourceId: string, id: string): Promise<void> {
    if (!id.trim()) throw new InvalidSourceInvestmentRecordError("记录 ID 无效");
    this.transaction(() => {
      if (!this.database.prepare("SELECT id FROM asset_sources WHERE id = ?").get(sourceId)) throw new InvalidSourceInvestmentRecordError("资产来源不存在");
      const result = this.database.prepare("DELETE FROM source_investment_records WHERE source_id = ? AND id = ?").run(sourceId, id);
      if (!result.changes) throw new InvalidSourceInvestmentRecordError("来源投资记录不存在");
    });
  }

  async listSourceInvestmentHistories(): Promise<SourceInvestmentHistory[]> {
    return this.readModel.listSourceInvestmentHistories();
  }

  private writeSourceInvestmentHistory(history: SourceInvestmentHistory): void {
    this.database.prepare("INSERT INTO asset_source_investment_histories (source_id, payload_json) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET payload_json = excluded.payload_json")
      .run(history.sourceId, JSON.stringify(history));
  }

  async importSourceInvestmentHistory(input: unknown): Promise<{ imported: boolean; records: number }> {
    const history = parseSourceInvestmentHistory(input);
    return this.transaction(() => {
      const source = this.database.prepare("SELECT kind, label FROM asset_sources WHERE id = ?").get(history.sourceId) as { kind: string; label: string } | undefined;
      if (!source || (source.kind !== "manual" && source.kind !== "longbridge") || source.label !== history.sourceLabel) throw new Error("导入目标来源身份不匹配");
      const local = this.readModel.listSourceInvestmentRecordsSync(history.sourceId);
      if (local.some(record => record.kind === "opening" || record.currency !== history.currency || record.day < history.openingInvestment.day)) throw new Error("导入历史与已有手工记录期初、币种或日期冲突");
      const row = this.database.prepare("SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?").get(history.sourceId) as { payload_json: string } | undefined;
      if (row) {
        const old = parseSourceInvestmentHistory(JSON.parse(row.payload_json));
        if (old.accountId !== history.accountId || old.provider !== history.provider || old.currency !== history.currency ||
            JSON.stringify(old.openingInvestment) !== JSON.stringify(history.openingInvestment)) throw new Error("导入账户与已有历史不一致");
        const incoming = new Map(history.records.map(record => [record.id, record]));
        if (old.records.some(record => JSON.stringify(record) !== JSON.stringify(incoming.get(record.id)))) throw new Error("导入包含历史覆盖或删除冲突");
        if (old.records.length === history.records.length) return { imported: false, records: old.records.length };
      }
      this.writeSourceInvestmentHistory(history);
      return { imported: true, records: history.records.length };
    });
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
    return this.readModel.listSourcesSync();
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
    return this.readModel.listDailyAssetSnapshotsSync();
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    return this.readModel.listDailyAssetTrendObservationsSync();
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return this.readModel.listImportedSourceHistoryObservationsSync();
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    return this.readModel.listManualAssetRecordsSync();
  }

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return this.readModel.listInvestmentCashflowsSync();
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
    return this.formalSettlements.list();
  }



  async recordFormalDailySettlementIfAbsent(
    settlement: FormalDailySettlement,
  ): Promise<boolean> {
    return this.transaction(() => this.formalSettlements.insert(settlement));
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
        ? this.readModel.listDailyObservationsSync(
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
      const source = this.readModel.listSourcesSync().find(
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
      const record = this.readModel.listManualAssetRecordsSync().find(
        (item) => item.sourceId === sourceId && item.day === input.day,
      );
      if (!record) throw new Error("手工资产记录保存失败");
      const latest = latestManualAssetRecord(
        this.readModel.listManualAssetRecordsSync().filter(
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
      const source = this.readModel.listSourcesSync().find(
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
        this.readModel.listManualAssetRecordsSync().filter(
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
      const source = this.readModel.listSourcesSync().find(({ id }) => id === sourceId);
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
        this.readModel.listSourcesSync(),
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
