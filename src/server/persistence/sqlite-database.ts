import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { InvestmentBookId, InvestmentBookStore } from "@/domain/investment-books";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDashboard, type SqliteDashboardComposition } from "./sqlite-database-composition";

import { type BusinessDataState } from "@/server/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { AssetFullRefreshStateDatabase, DashboardDatabase, FormalDailySettlementDatabase, FormalSettlementExecutionDatabase } from "@/server/persistence/contracts";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, FormalDailySettlement, FormalSettlementExecution, ImportedAssetSourceHistoryObservation, InvestmentCashflow, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

/** SQLite 业务适配器；装配与启动交由组合根，跨表事务仍在此编排。 */
export class SqliteDashboardDatabase
  implements DashboardDatabase, InvestmentCashflowStore, InvestmentBookStore,
    AssetFullRefreshStateDatabase, FormalDailySettlementDatabase, FormalSettlementExecutionDatabase
{
  private readonly database: DatabaseSync;
  private readonly stores: SqliteDashboardComposition;

  constructor(
    databasePath: string,
  ) {
    this.stores = openSqliteDashboard(databasePath);
    this.database = this.stores.database;
  }

  close(): void {
    this.database.close();
  }

  async readInvestmentBooks() {
    return this.transaction(() => this.stores.investmentBooks.read());
  }
  async readStoredInvestmentBooks() {
    return this.stores.investmentBooks.stored();
  }
  async saveBookRecord(bookId: InvestmentBookId, value: unknown, capturedAt: string): Promise<void> {
    this.transaction(() => this.stores.investmentBooks.save(bookId, value, capturedAt));
  }
  async voidBookRecord(bookId: InvestmentBookId, id: string, capturedAt: string): Promise<void> {
    this.transaction(() => this.stores.investmentBooks.void(bookId, id, capturedAt));
  }
  async importBookHistory(bookId: InvestmentBookId, value: unknown): Promise<void> {
    this.transaction(() => this.stores.investmentBooks.import(bookId, value));
  }
  async confirmBookMember(sourceId: string, fromDay: string, toDay: string | null): Promise<void> {
    this.transaction(() => this.stores.investmentBooks.confirmMember(sourceId, fromDay, toDay));
  }
  async resolveLegacyCashflow(bookId: InvestmentBookId, cashflowId: string, recordId: string | null): Promise<void> {
    this.transaction(() => this.stores.investmentBooks.resolveLegacy(bookId, cashflowId, recordId));
  }
  private requireLegacyInvestmentWrites(): void {
    if (this.database.prepare("SELECT 1 FROM investment_book_state WHERE id = 1").get()) throw new Error("资金记账已统一到三本账，请到投资账本中选择账本操作");
  }

  async readAssetFullRefreshState(): Promise<{
    attemptedAt: string | null;
    inProgressAt: string | null;
  }> {
    return this.stores.refreshState.read();
  }

  async startAssetFullRefresh(attemptedAt: string): Promise<void> {
    this.transaction(() => this.stores.refreshState.start(attemptedAt));
  }

  async initializeAssetFullRefresh(attemptedAt: string): Promise<boolean> {
    return this.transaction(() => this.stores.refreshState.initialize(attemptedAt));
  }

  async claimAssetFullRefresh(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    return this.transaction(() => this.stores.refreshState.claim(input));
  }

  async finishAssetFullRefresh(attemptedAt?: string): Promise<void> {
    this.transaction(() => this.stores.refreshState.finish(attemptedAt));
  }

  async clearAssetFullRefresh(): Promise<void> {
    this.transaction(() => this.stores.refreshState.clear());
  }

  private transaction<T>(operation: () => T): T {
    return this.stores.transactions.run(operation);
  }

  async readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    return this.stores.readModel.readSourceDetail(query);
  }

  async listSourceInvestmentRecords(sourceId?: string): Promise<SourceInvestmentRecord[]> {
    return this.stores.readModel.listSourceInvestmentRecordsSync(sourceId);
  }

  async saveSourceInvestmentRecord(sourceId: string, input: SourceInvestmentRecordInput, capturedAt: string): Promise<void> {
    this.requireLegacyInvestmentWrites();
    const record = parseSourceInvestmentRecordInput(input, capturedAt);
    this.transaction(() => this.stores.sourceInvestments.saveRecord(sourceId, record, capturedAt));
  }

  async deleteSourceInvestmentRecord(sourceId: string, id: string): Promise<void> {
    this.requireLegacyInvestmentWrites();
    if (!id.trim()) throw new InvalidSourceInvestmentRecordError("记录 ID 无效");
    this.transaction(() => this.stores.sourceInvestments.deleteRecord(sourceId, id));
  }

  async listSourceInvestmentHistories(): Promise<SourceInvestmentHistory[]> {
    return this.stores.readModel.listSourceInvestmentHistories();
  }

  async importSourceInvestmentHistory(input: unknown): Promise<{ imported: boolean; records: number }> {
    this.requireLegacyInvestmentWrites();
    const history = parseSourceInvestmentHistory(input);
    return this.transaction(() => this.stores.sourceInvestments.importHistory(history));
  }

  async listAssetCards(): Promise<Card[]> {
    return this.stores.cards.list();
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    this.transaction(() => this.stores.cards.replace(cards));
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    return this.stores.readModel.listSourcesSync();
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    this.transaction(() => this.stores.sourceReplacement.replace(sources));
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    this.transaction(() => this.stores.sourceData.update(source));
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    return this.stores.readModel.listDailyAssetSnapshotsSync();
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    return this.stores.readModel.listDailyAssetTrendObservationsSync();
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return this.stores.readModel.listImportedSourceHistoryObservationsSync();
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    return this.stores.readModel.listManualAssetRecordsSync();
  }

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return this.stores.readModel.listInvestmentCashflowsSync();
  }

  async createInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.requireLegacyInvestmentWrites();
    this.transaction(() => {
      this.stores.investmentCashflows.insert(cashflow);
    });
  }

  async updateInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.requireLegacyInvestmentWrites();
    this.transaction(() => {
      this.stores.investmentCashflows.update(cashflow);
    });
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    this.requireLegacyInvestmentWrites();
    this.transaction(() => {
      this.stores.investmentCashflows.delete(id);
    });
  }

  async latestFormalSettlementExecution(): Promise<FormalSettlementExecution | null> {
    return this.stores.formalSettlementExecutions.latest();
  }

  async recordFormalSettlementExecution(execution: FormalSettlementExecution): Promise<void> {
    this.transaction(() => this.stores.formalSettlementExecutions.record(execution));
  }

  async listFormalDailySettlements(): Promise<FormalDailySettlement[]> {
    return this.stores.readModel.listFormalDailySettlementsSync();
  }



  async recordFormalDailySettlementIfAbsent(
    settlement: FormalDailySettlement,
  ): Promise<boolean> {
    return this.transaction(() => this.stores.formalSettlements.insert(settlement));
  }

  async validateBusinessData(state: BusinessDataState): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.stores.businessData.replace(state);
      this.stores.transactions.assertIntegrity();
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
      this.stores.businessData.replace(state);
      this.stores.transactions.assertIntegrity();
    });
  }

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.transaction(() => {
      const inserted = this.stores.observations.insertBaseline(snapshot);
      if (inserted) this.stores.observations.upsertTrend(snapshot);
      return inserted;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    this.transaction(() => this.stores.observations.record(snapshot, createBaseline));
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    this.transaction(() => this.stores.cards.setHidden(sourceId, hidden));
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    this.transaction(() => this.stores.sourceData.setDisplayName(sourceId, displayName));
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    this.transaction(() => this.stores.sourceData.setManualClass(sourceId, assetClass));
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    this.transaction(() => this.stores.sourceData.setEvmTokenPreferences(sourceId, ignoredAssetKeys, includedAssetKeys));
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.stores.manualSources.createManual(input, capturedAt));
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.stores.manualSources.recordManual(sourceId, input, capturedAt));
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => this.stores.manualSources.deleteManualRecord(sourceId, day, capturedAt));
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.stores.sourceConnections.disconnect(sourceId));
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.transaction(() => this.stores.sourceConnections.delete(sourceId));
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
    return this.transaction(() => this.stores.sourceConnections.reconnect(sourceId, sourceKind, result, credentialReference));
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
    this.transaction(() => this.stores.sourceConnections.connect(sourceKind, result, credentialReference, capturedAt));
  }
}
