import { parseConnection, type LongbridgeTransportStatus } from "@/server/asset-sources/longbridge-connection";
import { sameAccount } from "@/server/asset-sources/longbridge-connection";
import type { LongbridgeAccountIdentity } from "@/server/asset-sources/longbridge-keychain-sdk";
import type { BackgroundCollectionStore, CollectionState } from "@/server/background-collection";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import type { AssetSourceRefreshGuard } from "@/server/ports";
import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { InvestmentBookId, InvestmentBookStore } from "@/domain/investment-books";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDashboard, type SqliteDashboardComposition } from "./sqlite-database-composition";
import { SqliteLongbridgeDailyAssets } from "./sqlite-longbridge-daily-assets";
import type { LongbridgeDailyAsset, LongbridgeDailyAssetsConfig } from "@/server/asset-sources/longbridge-daily-assets";

import { type BusinessDataState } from "@/server/backup/business-data-backup";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import type { AssetFullRefreshStateDatabase, DashboardDatabase, FormalDailySettlementDatabase, FormalSettlementExecutionDatabase } from "@/server/persistence/contracts";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, FormalDailySettlement, FormalSettlementExecution, ImportedAssetSourceHistoryObservation, InvestmentCashflow, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

/** SQLite 业务适配器；装配与启动交由组合根，跨表事务仍在此编排。 */
export class SqliteDashboardDatabase
  implements DashboardDatabase, InvestmentCashflowStore, InvestmentBookStore, BackgroundCollectionStore,
    AssetFullRefreshStateDatabase, FormalDailySettlementDatabase, FormalSettlementExecutionDatabase
{
  private readonly database: DatabaseSync;
  private readonly stores: SqliteDashboardComposition;
  private readonly longbridgeDailyAssets: SqliteLongbridgeDailyAssets;

  constructor(
    databasePath: string,
  ) {
    this.stores = openSqliteDashboard(databasePath);
    this.database = this.stores.database;
    this.longbridgeDailyAssets = new SqliteLongbridgeDailyAssets(this.stores);
  }

  async listLongbridgeDailyAssets(now: string) { return this.longbridgeDailyAssets.list(now); }
  async claimLongbridgeDailyAssets(token: string, now: string) { return this.transaction(() => this.longbridgeDailyAssets.claim(token, now)); }
  async releaseLongbridgeDailyAssets(token: string) { this.transaction(() => this.longbridgeDailyAssets.release(token)); }
  async saveLongbridgeDailyAssets(config: LongbridgeDailyAssetsConfig, rows: LongbridgeDailyAsset[], now: string, token?: string) {
    return this.transaction(() => this.longbridgeDailyAssets.save(config, rows, now, token));
  }

  longbridgeAccount(sourceId: string): LongbridgeAccountIdentity | null {
    const source = this.stores.readModel.listSourcesSync().find(source => source.id === sourceId);
    const bound = parseConnection(source?.credentialReference ?? null)?.account;
    const daily = this.stores.metadata.get(`longbridge_daily_assets:${sourceId}`);
    const pinned = this.stores.metadata.get(`longbridge_account:${sourceId}`);
    return bound ?? (daily ? JSON.parse(daily).account : null) ?? (pinned ? JSON.parse(pinned) : null);
  }

  pinLongbridgeAccount(sourceId: string, account: LongbridgeAccountIdentity): void {
    this.transaction(() => {
      const existing = this.longbridgeAccount(sourceId);
      if (existing) sameAccount(existing, account);
      this.stores.metadata.set(`longbridge_account:${sourceId}`, JSON.stringify(account));
    });
  }

  longbridgeTransport(sourceId: string): LongbridgeTransportStatus | null {
    const source = this.stores.readModel.listSourcesSync().find(item => item.id === sourceId);
    const value = this.stores.metadata.get(`longbridge_transport:${sourceId}`);
    if (!value) return null;
    const saved = JSON.parse(value);
    return saved.reference === source?.credentialReference ? saved.status : null;
  }

  recordLongbridgeTransport(reference: string, status: LongbridgeTransportStatus): void {
    this.transaction(() => {
      const source = this.stores.readModel.listSourcesSync().find(item => item.kind === "longbridge" && item.credentialReference === reference && item.lifecycle !== "disconnected");
      if (!source) return;
      const previous = this.longbridgeTransport(source.id);
      // 同一通道最多每分钟更新一次；切换通道立即记录，不对每个报价写库。
      if (previous?.transport === status.transport && previous.fallback === status.fallback && Date.parse(status.at) - Date.parse(previous.at) < 60_000) return;
      this.stores.metadata.set(`longbridge_transport:${source.id}`, JSON.stringify({ reference, status }));
    });
  }

  readonly refreshGuard: AssetSourceRefreshGuard = {
    claim: (input) => Promise.resolve(this.transaction(() => this.stores.refreshState.claimLease(
      `asset_source_refresh:${input.sourceId}`, input.token, input.now, input.leaseMs,
    ))),
    owns: (input) => Promise.resolve(this.stores.refreshState.ownsLease(
      `asset_source_refresh:${input.sourceId}`, input.token, input.now,
    )),
    commit: (input) => Promise.resolve(this.transaction(() => {
      if (!this.stores.refreshState.ownsLease(`asset_source_refresh:${input.sourceId}`, input.token, input.now)) return false;
      const current = this.stores.readModel.listSourcesSync().find(source => source.id === input.sourceId);
      const next = input.source;
      if (!current || current.lifecycle === "disconnected" || current.kind !== next.kind ||
          current.accountId !== next.accountId || current.credentialReference !== next.credentialReference ||
          current.snapshot.syncedAt > next.snapshot.syncedAt ||
          (current.sync.lastAttemptAt ?? "") > (next.sync.lastAttemptAt ?? "")) return false;
      this.stores.sourceData.writeDetails({ ...current, snapshot: next.snapshot, sync: next.sync });
      if (input.recordObservation) {
        this.stores.observations.record(buildDailyAssetSnapshot(
          this.stores.readModel.listSourcesSync(), next.snapshot.syncedAt, new Set([next.id]),
        ), true);
      }
      return true;
    })),
    release: (input) => Promise.resolve(this.transaction(() => this.stores.refreshState.releaseLease(
      `asset_source_refresh:${input.sourceId}`, input.token,
    ))),
  };

  async readCollectionState(): Promise<CollectionState | null> {
    const value = this.stores.metadata.get("background_collection_state");
    return value ? JSON.parse(value) as CollectionState : null;
  }
  async saveCollectionState(state: CollectionState): Promise<void> {
    this.transaction(() => this.stores.metadata.set("background_collection_state", JSON.stringify(state)));
  }
  async claimCollection(token: string, now: string): Promise<boolean> {
    return this.transaction(() => this.stores.refreshState.claimLease("background_collection_lease", token, now, 5 * 60_000));
  }
  async releaseCollection(token: string): Promise<void> {
    this.transaction(() => this.stores.refreshState.releaseLease("background_collection_lease", token));
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

  async connectPlugin(kind: import("@/server/asset-source-plugins/protocol").AssetSourcePluginId, result: import("@/server/asset-source-plugins/protocol").AssetSourcePluginAuthorization, reference: string, capturedAt: string): Promise<void> {
    this.connectAssetSource(kind, result, reference, capturedAt);
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
  ): Promise<string | null> {
    return this.transaction(() => {
      const connection = sourceKind === "longbridge" ? parseConnection(credentialReference) : null;
      if (connection) {
        const previous = this.longbridgeAccount(sourceId);
        if (previous) sameAccount(previous, connection.account);
        this.stores.metadata.set(`longbridge_account:${sourceId}`, JSON.stringify(connection.account));
        const key = `longbridge_daily_assets:${sourceId}`;
        const daily = this.stores.metadata.get(key);
        if (daily) {
          const config = JSON.parse(daily) as LongbridgeDailyAssetsConfig;
          sameAccount(config.account, connection.account);
          this.stores.metadata.set(key, JSON.stringify({ ...config, credentialReference }));
        }
      }
      return this.stores.sourceConnections.reconnect(sourceId, sourceKind, result, credentialReference);
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
    this.transaction(() => this.stores.sourceConnections.connect(sourceKind, result, credentialReference, capturedAt));
  }
}
