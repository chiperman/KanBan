import { createHash } from "node:crypto";
import path from "node:path";

import type { Clock } from "@/server/ports";
import {
  atomicWritePrivateFile,
  ensurePrivateDirectory,
  readPrivateFile,
} from "@/server/local-data-permissions";
import {
  BACKUP_FORMAT_VERSION,
  decodeBackupDocument,
  encodeBackupDocument,
  LEGACY_HISTORY_WARNING,
  SENSITIVE_ASSET_DATA_WARNING,
  type BackupRestorePreview,
  type BusinessDataBackup,
  type BusinessDataBackupStore,
  type BusinessDataState,
} from "./backup/document-codec";

export { SENSITIVE_ASSET_DATA_WARNING } from "./backup/document-codec";
export type {
  BackupRestorePreview,
  BusinessDataBackup,
  BusinessDataBackupStore,
  BusinessDataState,
} from "./backup/document-codec";

export class CredentialFreeBusinessDataBackup implements BusinessDataBackup {
  constructor(
    private readonly store: BusinessDataBackupStore,
    private readonly backupDirectory: string,
    private readonly clock: Clock,
  ) {}

  private backupPath(fileName: string): string {
    if (
      path.basename(fileName) !== fileName ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(fileName)
    ) {
      throw new Error("备份文件名无效");
    }
    return path.join(this.backupDirectory, fileName);
  }

  private async decode(fileName: string): Promise<{ state: BusinessDataState; formatVersion: number }> {
    const decoded = decodeBackupDocument(await readPrivateFile(this.backupPath(fileName)));
    await this.store.validateBusinessData(decoded.state);
    return decoded;
  }

  private async previewFor(state: BusinessDataState, formatVersion = BACKUP_FORMAT_VERSION): Promise<BackupRestorePreview> {
    const [currentSources, currentCards, currentSnapshots, manualRecords, settlements, sourceHistories, sourceRecords] = await Promise.all([
      this.store.listSources(),
      this.store.listAssetCards(),
      this.store.listDailyAssetSnapshots(),
      this.store.listManualAssetRecords(),
      this.store.listFormalDailySettlements(),
      this.store.listSourceInvestmentHistories?.() ?? Promise.resolve([]),
      this.store.listSourceInvestmentRecords?.() ?? Promise.resolve([]),
    ]);
    const dropsHistory = (formatVersion < 5 && (manualRecords.length > 0 || settlements.length > 0)) || (formatVersion < 6 && sourceHistories.length > 0) || (formatVersion < 7 && sourceRecords.length > 0);
    const days = state.dailyAssetSnapshots.map(({ day }) => day).sort();
    return {
      ...(formatVersion < BACKUP_FORMAT_VERSION ? { omittedHistory: { manualAssetRecords: formatVersion < 5 ? manualRecords.length : 0, formalDailySettlements: formatVersion < 5 ? settlements.length : 0, ...(formatVersion < 6 && sourceHistories.length ? { sourceInvestmentHistories: sourceHistories.length } : {}), ...(formatVersion < 7 && sourceRecords.length ? { sourceInvestmentRecords: sourceRecords.length } : {}) } } : {}),
      ...(dropsHistory ? { discardConfirmation: createHash("sha256").update(JSON.stringify({state, manualRecords, settlements, sourceHistories, sourceRecords})).digest("hex") } : {}),
      sourceCount: state.assetSources.length,
      cardCount: state.assetCards.length,
      snapshotRange: {
        from: days[0] ?? null,
        to: days.at(-1) ?? null,
      },
      replaces: {
        sourceCount: currentSources.length,
        cardCount: currentCards.length,
        snapshotCount: currentSnapshots.length,
      },
      warning: formatVersion < BACKUP_FORMAT_VERSION
        ? `${SENSITIVE_ASSET_DATA_WARNING}${formatVersion < 5 ? LEGACY_HISTORY_WARNING : ""}${formatVersion < 6 ? "旧版备份不包含来源投资历史。" : ""}旧版备份不包含来源手工投资记录。`
        : SENSITIVE_ASSET_DATA_WARNING,
    };
  }

  async exportBackup(fileName?: string) {
    const createdAt = this.clock.now().toISOString();
    const resolvedFileName = fileName ?? `asset-dashboard-${createdAt.replace(/[:.]/g, "-")}.json`;
    const [
      assetCards,
      sources,
      dailyAssetSnapshots,
      dailyAssetTrendObservations,
      importedAssetSourceHistoryObservations,
      investmentCashflows,
      manualAssetRecords,
      formalDailySettlements,
      sourceInvestmentHistories,
      sourceInvestmentRecords,
    ] = await Promise.all([
      this.store.listAssetCards(),
      this.store.listSources(),
      this.store.listDailyAssetSnapshots(),
      this.store.listDailyAssetTrendObservations(),
      this.store.listImportedSourceHistoryObservations(),
      this.store.listInvestmentCashflows(),
      this.store.listManualAssetRecords(),
      this.store.listFormalDailySettlements(),
      this.store.listSourceInvestmentHistories?.() ?? Promise.resolve([]),
      this.store.listSourceInvestmentRecords?.() ?? Promise.resolve([]),
    ]);
    const { contents, checksum } = encodeBackupDocument({
      assetCards,
      assetSources: sources,
      dailyAssetSnapshots,
      dailyAssetTrendObservations,
      importedAssetSourceHistoryObservations,
      investmentCashflows,
      manualAssetRecords,
      formalDailySettlements,
      sourceInvestmentHistories,
      sourceInvestmentRecords,
    }, createdAt);
    await ensurePrivateDirectory(this.backupDirectory);
    await atomicWritePrivateFile(
      this.backupPath(resolvedFileName),
      contents,
    );
    return {
      fileName: resolvedFileName,
      checksum,
      warning: SENSITIVE_ASSET_DATA_WARNING,
    };
  }

  async previewRestore(fileName: string): Promise<BackupRestorePreview> {
    const decoded = await this.decode(fileName);
    return this.previewFor(decoded.state, decoded.formatVersion);
  }

  async restore(fileName: string, discardConfirmation?: string): Promise<BackupRestorePreview> {
    const decoded = await this.decode(fileName);
    const preview = await this.previewFor(decoded.state, decoded.formatVersion);
    if (preview.discardConfirmation && discardConfirmation !== preview.discardConfirmation) {
      throw new Error("旧备份将丢弃现有历史数据，请重新预演并明确确认丢弃范围");
    }
    await this.store.replaceBusinessData(decoded.state);
    return preview;
  }
}
