import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
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
export const SQLITE_SCHEMA_VERSION = 20;

export interface DashboardDatabase {
  listAssetCards(): Promise<Card[]>;
  replaceAssetCards(cards: Card[]): Promise<void>;
  listSources(): Promise<AssetSourceSummary[]>;
  replaceSources(sources: AssetSourceSummary[]): Promise<void>;
  updateSource(source: AssetSourceSummary): Promise<void>;
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
  setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void>;
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
  disconnectAssetSource(sourceId: string): Promise<string | null>;
  deleteAssetSourceData(sourceId: string): Promise<string | null>;
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
    capturedAt: string,
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

export type SqliteRow = Record<string, string | number | null>;
