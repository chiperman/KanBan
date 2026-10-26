import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import type { AssetFullRefreshState, FormalDailySettlements, FormalSettlementExecutions } from "@/server/ports";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, ImportedAssetSourceHistoryObservation, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

export interface DashboardState {
  schemaVersion: 9;
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  manualAssetRecords: ManualAssetRecord[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  importedAssetSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
}

export const DASHBOARD_SCHEMA_VERSION = 9 as const;
export const SQLITE_SCHEMA_VERSION = 24;

/** 卡片布局持久化所需的最小接口。 */
export interface AssetCardDatabase {
  listAssetCards(): Promise<Card[]>;
  replaceAssetCards(cards: Card[]): Promise<void>;
  setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void>;
}

/** 来源摘要与来源生命周期持久化所需的最小接口。 */
export interface AssetSourceDatabase {
  refreshGuard?: import("@/server/ports").AssetSourceRefreshGuard;
  listSources(): Promise<AssetSourceSummary[]>;
  replaceSources(sources: AssetSourceSummary[]): Promise<void>;
  updateSource(source: AssetSourceSummary): Promise<void>;
  setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void>;
  setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void>;
  setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void>;
  disconnectAssetSource(sourceId: string): Promise<string | null>;
  deleteAssetSourceData(sourceId: string): Promise<string | null>;
}

/** 每日基准、趋势与来源历史观测持久化所需的最小接口。 */
export interface AssetSnapshotDatabase {
  listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]>;
  listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  >;
  createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean>;
  recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void>;
}

/** 手工来源记录持久化所需的最小接口。 */
export interface ManualAssetRecordDatabase {
  createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void>;
  listManualAssetRecords(): Promise<ManualAssetRecord[]>;
  recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void>;
  deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void>;
}

/** 来源授权写入持久化所需的最小接口。 */
export interface AssetSourceConnectionDatabase {
  connectPlugin?(kind: import("@/server/asset-source-plugins/protocol").AssetSourcePluginId, result: import("@/server/asset-source-plugins/protocol").AssetSourcePluginAuthorization, reference: string, capturedAt: string): Promise<void>;
  connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
  ): Promise<string | null>;
  connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
}

/** 刷新周期适配器所需的最小数据库接口。 */
export interface AssetFullRefreshStateDatabase {
  readAssetFullRefreshState: AssetFullRefreshState["read"];
  initializeAssetFullRefresh: AssetFullRefreshState["initialize"];
  claimAssetFullRefresh: AssetFullRefreshState["claim"];
  startAssetFullRefresh: AssetFullRefreshState["start"];
  finishAssetFullRefresh: AssetFullRefreshState["finish"];
  clearAssetFullRefresh: AssetFullRefreshState["clear"];
}

/** 正式日结适配器所需的最小数据库接口。 */
export interface FormalDailySettlementDatabase {
  listFormalDailySettlements: FormalDailySettlements["list"];
  recordFormalDailySettlementIfAbsent: FormalDailySettlements["recordIfAbsent"];
}

/** 正式日结执行记录适配器所需的最小数据库接口。 */
export interface FormalSettlementExecutionDatabase {
  latestFormalSettlementExecution: FormalSettlementExecutions["latest"];
  recordFormalSettlementExecution: FormalSettlementExecutions["record"];
}

/** 兼容旧组合根的完整数据库接口；新适配器应依赖上面的最小接口。 */
export interface DashboardDatabase
  extends AssetCardDatabase,
    AssetSourceDatabase,
    AssetSnapshotDatabase,
    ManualAssetRecordDatabase,
    AssetSourceConnectionDatabase {}

export type SqliteRow = Record<string, string | number | null>;
