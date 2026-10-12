import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { chmodSync, existsSync } from "node:fs";
import { SqliteDashboardReadModel } from "./sqlite-read-model";
import { SqliteFormalSettlementStore } from "./sqlite-formal-settlements";
import { SqliteObservationStore } from "./sqlite-observation-store";
import { SqliteSourceInvestmentStore } from "./sqlite-source-investment-store";
import { SqliteManualAssetSourceStore } from "./sqlite-manual-asset-source-store";
import { SqliteInvestmentCashflowStore } from "./sqlite-investment-cashflow-store";
import { SqliteFormalSettlementExecutionStore } from "./sqlite-formal-settlement-execution-store";
import { SqliteBusinessDataStore } from "./sqlite-business-data-store";
import { SqliteRefreshStateStore } from "./sqlite-refresh-state-store";
import { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import { SqliteMetadataStore } from "./sqlite-metadata-store";
import { SqliteManualAssetRecordStore } from "./sqlite-manual-asset-record-store";
import { SqliteAssetSourceConnectionStore } from "./sqlite-asset-source-connection-store";
import { SqliteAssetSourceDataStore } from "./sqlite-asset-source-data-store";
import { SqliteAssetSourceReplacementStore } from "./sqlite-asset-source-replacement-store";
import { SqliteDatabaseInitializationStore } from "./sqlite-database-initialization-store";

import { type BusinessDataState } from "@/server/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { DashboardDatabase, SqliteRow } from "@/server/persistence/contracts";
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
  private manualSources!: SqliteManualAssetSourceStore;
  private investmentCashflows!: SqliteInvestmentCashflowStore;
  private formalSettlementExecutions!: SqliteFormalSettlementExecutionStore;
  private businessData!: SqliteBusinessDataStore;
  private refreshState!: SqliteRefreshStateStore;
  private cards!: SqliteAssetCardStore;
  private metadataStore!: SqliteMetadataStore;
  private manualRecords!: SqliteManualAssetRecordStore;
  private sourceConnections!: SqliteAssetSourceConnectionStore;
  private sourceData!: SqliteAssetSourceDataStore;
  private sourceReplacement!: SqliteAssetSourceReplacementStore;
  private initialization!: SqliteDatabaseInitializationStore;

  constructor(
    private readonly databasePath: string,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {
    try {
      this.database = new DatabaseSync(databasePath);
      this.cards = new SqliteAssetCardStore(this.database);
      this.metadataStore = new SqliteMetadataStore(this.database);
      this.manualRecords = new SqliteManualAssetRecordStore(this.database);
      this.sourceData = new SqliteAssetSourceDataStore(this.database);
      this.sourceReplacement = new SqliteAssetSourceReplacementStore(
        this.database,
        this.sourceData,
      );
      this.readModel = new SqliteDashboardReadModel(this.database);
      this.formalSettlements = new SqliteFormalSettlementStore(this.database);
      this.observations = new SqliteObservationStore(this.database, this.readModel);
      this.sourceInvestments = new SqliteSourceInvestmentStore(this.database, this.readModel);
      this.manualSources = new SqliteManualAssetSourceStore(
        this.database,
        this.readModel,
        this.observations,
        this.cards,
        this.manualRecords,
        this.sourceData,
      );
      this.sourceConnections = new SqliteAssetSourceConnectionStore(
        this.database,
        this.sourceData,
        this.readModel,
        this.observations,
        this.cards,
      );
      this.investmentCashflows = new SqliteInvestmentCashflowStore(this.database);
      this.formalSettlementExecutions = new SqliteFormalSettlementExecutionStore(this.database);
      this.refreshState = new SqliteRefreshStateStore(this.metadataStore);
      this.businessData = new SqliteBusinessDataStore(
        this.database,
        this.observations,
        this.investmentCashflows,
        this.sourceInvestments,
        this.formalSettlements,
        this.cards,
        this.manualRecords,
        this.sourceData,
      );
      this.initialization = new SqliteDatabaseInitializationStore(
        this.database,
        (operation) => this.transaction(operation),
        this.metadataStore,
        this.businessData,
        this.legacyDashboardPath,
        this.legacyCardsPath,
      );
      chmodSync(databasePath, 0o600);
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.initialization.initialize();
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

  async readAssetFullRefreshState(): Promise<{
    attemptedAt: string | null;
    inProgressAt: string | null;
  }> {
    return this.refreshState.read();
  }

  async startAssetFullRefresh(attemptedAt: string): Promise<void> {
    this.transaction(() => this.refreshState.start(attemptedAt));
  }

  async initializeAssetFullRefresh(attemptedAt: string): Promise<boolean> {
    return this.transaction(() => this.refreshState.initialize(attemptedAt));
  }

  async claimAssetFullRefresh(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    return this.transaction(() => this.refreshState.claim(input));
  }

  async finishAssetFullRefresh(attemptedAt?: string): Promise<void> {
    this.transaction(() => this.refreshState.finish(attemptedAt));
  }

  async clearAssetFullRefresh(): Promise<void> {
    this.transaction(() => this.refreshState.clear());
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
    return this.cards.list();
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    this.transaction(() => this.cards.replace(cards));
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    return this.readModel.listSourcesSync();
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    this.transaction(() => this.sourceReplacement.replace(sources));
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    this.transaction(() => this.sourceData.update(source));
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
    return this.formalSettlementExecutions.latest();
  }

  async recordFormalSettlementExecution(execution: FormalSettlementExecution): Promise<void> {
    this.transaction(() => this.formalSettlementExecutions.record(execution));
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
      this.businessData.replace(state);
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
      this.businessData.replace(state);
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
    this.transaction(() => this.cards.setHidden(sourceId, hidden));
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    this.transaction(() => this.sourceData.setDisplayName(sourceId, displayName));
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    this.transaction(() => this.sourceData.setManualClass(sourceId, assetClass));
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    this.transaction(() => this.sourceData.setEvmTokenPreferences(sourceId, ignoredAssetKeys, includedAssetKeys));
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.manualSources.createManual(input, capturedAt));
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.manualSources.recordManual(sourceId, input, capturedAt));
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.manualSources.deleteManualRecord(sourceId, day, capturedAt));
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.sourceConnections.disconnect(sourceId));
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.sourceConnections.delete(sourceId));
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
    return this.transaction(() => this.sourceConnections.reconnect(sourceId, sourceKind, result, credentialReference));
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
    this.transaction(() => this.sourceConnections.connect(sourceKind, result, credentialReference, capturedAt));
  }
}
