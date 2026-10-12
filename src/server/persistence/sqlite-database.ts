import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { chmodSync, copyFileSync, existsSync, readFileSync, } from "node:fs";
import { DashboardSchema } from "./sqlite-schema";
import { SqliteDashboardReadModel } from "./sqlite-read-model";
import { SqliteFormalSettlementStore } from "./sqlite-formal-settlements";
import { SqliteObservationStore } from "./sqlite-observation-store";
import { SqliteSourceInvestmentStore } from "./sqlite-source-investment-store";
import { SqliteAssetSourceStore } from "./sqlite-asset-source-store";
import { SqliteInvestmentCashflowStore } from "./sqlite-investment-cashflow-store";

import { type BusinessDataState } from "@/server/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { DashboardDatabase, DashboardState, SqliteRow } from "@/server/persistence/contracts";
import { migrateDailyObservation, parseLegacyDashboardStateSync } from "@/server/persistence/migrations";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, FormalDailySettlement, FormalSettlementExecution, ImportedAssetSourceHistoryObservation, InvestmentCashflow, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

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
  private observations!: SqliteObservationStore;
  private sourceInvestments!: SqliteSourceInvestmentStore;
  private sources!: SqliteAssetSourceStore;
  private investmentCashflows!: SqliteInvestmentCashflowStore;

  constructor(
    private readonly databasePath: string,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {
    try {
      this.database = new DatabaseSync(databasePath);
      this.readModel = new SqliteDashboardReadModel(this.database);
      this.formalSettlements = new SqliteFormalSettlementStore(this.database);
      this.observations = new SqliteObservationStore(this.database, this.readModel);
      this.sourceInvestments = new SqliteSourceInvestmentStore(this.database, this.readModel);
      this.sources = new SqliteAssetSourceStore(this.database, this.readModel, this.observations);
      this.investmentCashflows = new SqliteInvestmentCashflowStore(this.database);
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
      this.sources.insert(source, position),
    );
    state.assetCards.forEach((card, position) => this.sources.insertCard(card, position));
    state.dailyAssetSnapshots.forEach((snapshot) =>
      this.observations.insertBaseline(migrateDailyObservation(snapshot)),
    );
    state.dailyAssetTrendObservations.forEach((observation) =>
      this.observations.upsertTrend(migrateDailyObservation(observation)),
    );
    const importedHistory = "importedAssetSourceHistoryObservations" in state
      ? state.importedAssetSourceHistoryObservations
      : [];
    importedHistory.forEach((observation) =>
      this.observations.insertImportedHistory(observation),
    );
    const cashflows = "investmentCashflows" in state
      ? (state as { investmentCashflows: InvestmentCashflow[] })
        .investmentCashflows
      : [];
    cashflows.forEach((cashflow) => this.investmentCashflows.insert(cashflow));
    if ("sourceInvestmentHistories" in state) {
      for (const history of state.sourceInvestmentHistories ?? []) this.sourceInvestments.writeHistory(history);
    }
    if ("sourceInvestmentRecords" in state) {
      for (const record of state.sourceInvestmentRecords ?? []) this.sourceInvestments.insertRecord(record);
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

  async readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    return this.readModel.readSourceDetail(query);
  }

  async listSourceInvestmentRecords(sourceId?: string): Promise<SourceInvestmentRecord[]> {
    return this.readModel.listSourceInvestmentRecordsSync(sourceId);
  }

  async saveSourceInvestmentRecord(sourceId: string, input: SourceInvestmentRecordInput, capturedAt: string): Promise<void> {
    const record = parseSourceInvestmentRecordInput(input, capturedAt);
    this.transaction(() => this.sourceInvestments.saveRecord(sourceId, record, capturedAt));
  }

  async deleteSourceInvestmentRecord(sourceId: string, id: string): Promise<void> {
    if (!id.trim()) throw new InvalidSourceInvestmentRecordError("记录 ID 无效");
    this.transaction(() => this.sourceInvestments.deleteRecord(sourceId, id));
  }

  async listSourceInvestmentHistories(): Promise<SourceInvestmentHistory[]> {
    return this.readModel.listSourceInvestmentHistories();
  }

  async importSourceInvestmentHistory(input: unknown): Promise<{ imported: boolean; records: number }> {
    const history = parseSourceInvestmentHistory(input);
    return this.transaction(() => this.sourceInvestments.importHistory(history));
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
      cards.forEach((card, position) => this.sources.insertCard(card, position));
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
      sources.forEach((source, position) => this.sources.insert(source, position));
    });
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    this.transaction(() => this.sources.update(source));
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
      this.investmentCashflows.insert(cashflow);
    });
  }

  async updateInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.transaction(() => {
      this.investmentCashflows.update(cashflow);
    });
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    this.transaction(() => {
      this.investmentCashflows.delete(id);
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
      const inserted = this.observations.insertBaseline(snapshot);
      if (inserted) this.observations.upsertTrend(snapshot);
      return inserted;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    this.transaction(() => this.observations.record(snapshot, createBaseline));
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    this.transaction(() => this.sources.setCardHidden(sourceId, hidden));
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    this.transaction(() => this.sources.setDisplayName(sourceId, displayName));
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    this.transaction(() => this.sources.setManualClass(sourceId, assetClass));
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    this.transaction(() => this.sources.setEvmTokenPreferences(sourceId, ignoredAssetKeys, includedAssetKeys));
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.sources.createManual(input, capturedAt));
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.sources.recordManual(sourceId, input, capturedAt));
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.sources.deleteManualRecord(sourceId, day, capturedAt));
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.sources.disconnect(sourceId));
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.sources.delete(sourceId));
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
    return this.transaction(() => this.sources.reconnect(sourceId, sourceKind, result, credentialReference, capturedAt));
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
    this.transaction(() => this.sources.connect(sourceKind, result, credentialReference, capturedAt));
  }
}
