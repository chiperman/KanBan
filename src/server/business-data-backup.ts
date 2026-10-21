import { createHash, randomUUID } from "node:crypto";
import { link, readdir, rm, stat } from "node:fs/promises";
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
  type BackupSummary,
  type BusinessDataBackup,
  type BusinessDataBackupStore,
  type BusinessDataState,
} from "./backup/document-codec";

export { SENSITIVE_ASSET_DATA_WARNING } from "./backup/document-codec";
export type {
  BackupRestorePreview,
  BackupSummary,
  BusinessDataBackup,
  BusinessDataBackupStore,
  BusinessDataState,
} from "./backup/document-codec";

/** 上传落盘的体积上限。实测本机全量业务数据约 1.5 MB，趋势观测仍会增长。 */
export const MAX_BACKUP_CONTENTS_BYTES = 32 * 1024 * 1024;
/** 上传文件名落盘前必须可安全使用；与本机导出产物同规则。 */
const BACKUP_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/i;

export class CredentialFreeBusinessDataBackup implements BusinessDataBackup {
  constructor(
    private readonly store: BusinessDataBackupStore,
    private readonly backupDirectory: string,
    private readonly clock: Clock,
  ) {}

  private backupPath(fileName: string): string {
    if (
      path.basename(fileName) !== fileName ||
      !BACKUP_FILE_NAME.test(fileName)
    ) {
      throw new Error("备份文件名无效");
    }
    return path.join(this.backupDirectory, fileName);
  }

  /** 完整写入私有临时文件后，以硬链接原子创建目标；同名时重试，不覆盖备份。 */
  private async saveBackup(fileName: string, contents: string): Promise<string> {
    this.backupPath(fileName);
    const base = fileName;
    const stem = base.slice(0, -".json".length);
    const temporaryPath = path.join(this.backupDirectory, `.backup-${randomUUID()}.tmp`);
    try {
      await atomicWritePrivateFile(temporaryPath, contents);
      for (let attempt = 0; ; attempt += 1) {
        const candidate = attempt === 0 ? base : `${stem}-${attempt}.json`;
        try {
          await link(temporaryPath, this.backupPath(candidate));
          return candidate;
        } catch (error) {
          if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") {
            throw error;
          }
        }
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async decode(fileName: string): Promise<{ state: BusinessDataState; formatVersion: number }> {
    const decoded = decodeBackupDocument(await readPrivateFile(this.backupPath(fileName)));
    await this.store.validateBusinessData(decoded.state);
    return decoded;
  }

  private async previewFor(state: BusinessDataState, formatVersion = BACKUP_FORMAT_VERSION): Promise<BackupRestorePreview> {
    const [currentSources, currentCards, currentSnapshots, manualRecords, settlements, sourceHistories, sourceRecords, investmentBooks] = await Promise.all([
      this.store.listSources(),
      this.store.listAssetCards(),
      this.store.listDailyAssetSnapshots(),
      this.store.listManualAssetRecords(),
      this.store.listFormalDailySettlements(),
      this.store.listSourceInvestmentHistories?.() ?? Promise.resolve([]),
      this.store.listSourceInvestmentRecords?.() ?? Promise.resolve([]),
      this.store.readStoredInvestmentBooks?.() ?? Promise.resolve(undefined),
    ]);
    const bookFacts = investmentBooks ? investmentBooks.records.length + investmentBooks.members.length : 0;
    const dropsBooks = !state.investmentBooks && bookFacts > 0;
    const dropsHistory = (formatVersion < 5 && (manualRecords.length > 0 || settlements.length > 0)) || (formatVersion < 6 && sourceHistories.length > 0) || (formatVersion < 7 && sourceRecords.length > 0) || dropsBooks;
    const days = state.dailyAssetSnapshots.map(({ day }) => day).sort();
    return {
      ...(formatVersion < BACKUP_FORMAT_VERSION || dropsBooks ? { omittedHistory: { manualAssetRecords: formatVersion < 5 ? manualRecords.length : 0, formalDailySettlements: formatVersion < 5 ? settlements.length : 0, ...(formatVersion < 6 && sourceHistories.length ? { sourceInvestmentHistories: sourceHistories.length } : {}), ...(formatVersion < 7 && sourceRecords.length ? { sourceInvestmentRecords: sourceRecords.length } : {}), ...(dropsBooks ? { investmentBookRecords: bookFacts } : {}) } } : {}),
      ...(dropsHistory ? { discardConfirmation: createHash("sha256").update(JSON.stringify({state, manualRecords, settlements, sourceHistories, sourceRecords, investmentBooks})).digest("hex") } : {}),
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
      warning: formatVersion < BACKUP_FORMAT_VERSION || dropsBooks
        ? `${SENSITIVE_ASSET_DATA_WARNING}${formatVersion < 5 ? LEGACY_HISTORY_WARNING : ""}${formatVersion < 6 ? "旧版备份不包含来源投资历史。" : ""}${formatVersion < 7 ? "旧版备份不包含来源手工投资记录。" : ""}${dropsBooks ? "此备份不包含三本账的记录、更正与来源范围。" : ""}`
        : SENSITIVE_ASSET_DATA_WARNING,
    };
  }

  async exportBackup(fileName?: string) {
    const createdAt = this.clock.now().toISOString();
    const requestedFileName = fileName ?? `asset-dashboard-${createdAt.replace(/[:.]/g, "-")}.json`;
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
      investmentBooks,
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
      this.store.readStoredInvestmentBooks?.() ?? Promise.resolve(undefined),
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
      investmentBooks,
    }, createdAt);
    const resolvedFileName = await this.saveBackup(requestedFileName, contents);
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

  /** 只列出业务数据 JSON：备份目录里还可能有手工放入的 SQLite 修复快照。 */
  async listBackups(): Promise<BackupSummary[]> {
    await ensurePrivateDirectory(this.backupDirectory);
    const entries = await readdir(this.backupDirectory);
    const summaries = await Promise.all(
      entries
        .filter((name) => BACKUP_FILE_NAME.test(name) && path.basename(name) === name)
        .map(async (fileName) => {
          const info = await stat(this.backupPath(fileName)).catch(() => null);
          if (info === null || !info.isFile()) return null;
          return {
            fileName,
            modifiedAt: info.mtime.toISOString(),
            size: info.size,
          };
        }),
    );
    return summaries
      .filter((entry) => entry !== null)
      .sort((left, right) => right.fileName.localeCompare(left.fileName));
  }

  /** 上传的备份先解码校验，再以 0600 落盘，之后可反复选择恢复。 */
  async importBackup(input: {
    contents: string;
    fileName: string;
  }): Promise<{ fileName: string; warning: string }> {
    const size = Buffer.byteLength(input.contents, "utf8");
    if (size > MAX_BACKUP_CONTENTS_BYTES) {
      throw new Error(
        `备份文件超过 ${MAX_BACKUP_CONTENTS_BYTES / (1024 * 1024)} MB，请确认选择的是业务数据备份`,
      );
    }
    const { state } = decodeBackupDocument(input.contents);
    await this.store.validateBusinessData(state);
    const fileName = await this.saveBackup(input.fileName, input.contents);
    return { fileName, warning: SENSITIVE_ASSET_DATA_WARNING };
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
