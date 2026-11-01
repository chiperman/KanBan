import type {
  BackupRestorePreview,
  BackupSummary,
  BusinessDataBackup,
} from "@/server/backup/business-data-backup";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export type BackupExport = Awaited<ReturnType<BusinessDataBackup["exportBackup"]>>;
export type UploadedBackup = Awaited<ReturnType<BusinessDataBackup["importBackup"]>>;

type BackupAction = "list" | "preview" | "export" | "restore" | "upload";

export class BackupOutcomeUnknown extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isBackupSummary(value: unknown): value is BackupSummary {
  return isRecord(value) &&
    isNonemptyString(value.fileName) &&
    isCount(value.size) &&
    (value.modifiedAt === null || (
      isNonemptyString(value.modifiedAt) && Number.isFinite(Date.parse(value.modifiedAt))
    ));
}

function isBackupList(value: unknown): value is { backups: BackupSummary[] } {
  return isRecord(value) && Array.isArray(value.backups) && value.backups.every(isBackupSummary);
}

function isUploadedBackup(value: unknown): value is UploadedBackup {
  return isRecord(value) && isNonemptyString(value.fileName) && isNonemptyString(value.warning);
}

function isBackupExport(value: unknown): value is BackupExport {
  return isUploadedBackup(value) && "checksum" in value && isNonemptyString(value.checksum);
}

function isBackupPreview(value: unknown): value is BackupRestorePreview {
  if (!isRecord(value) || !isCount(value.sourceCount) || !isCount(value.cardCount) ||
    !isNonemptyString(value.warning) || !isRecord(value.snapshotRange) || !isRecord(value.replaces)) return false;
  const { from, to } = value.snapshotRange;
  if (!(from === null && to === null) && !(isDay(from) && isDay(to) && from <= to)) return false;
  if (!isCount(value.replaces.sourceCount) || !isCount(value.replaces.cardCount) ||
    !isCount(value.replaces.snapshotCount)) return false;
  if (value.discardConfirmation !== undefined && !isNonemptyString(value.discardConfirmation)) return false;
  if (value.omittedHistory !== undefined) {
    const history = value.omittedHistory;
    if (!isRecord(history) || !isCount(history.manualAssetRecords) || !isCount(history.formalDailySettlements)) return false;
    for (const field of ["sourceInvestmentHistories", "sourceInvestmentRecords", "investmentBookRecords", "investmentCashflows"]) {
      if (history[field] !== undefined && !isCount(history[field])) return false;
    }
  }
  return true;
}

function unknownOutcome(action: "restore" | "upload") {
  return new BackupOutcomeUnknown(action === "restore"
    ? "未能确认恢复结果，请先核对当前数据，再重新预演恢复。"
    : "尚未确认备份是否保存，请重新读取备份列表后核对。");
}

async function readBackupResponse<T>(
  response: Response,
  action: BackupAction,
  accepts: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (response.status >= 500 && (action === "restore" || action === "upload")) throw unknownOutcome(action);
  const result = await readJsonResult<unknown>(response);
  signal?.throwIfAborted();
  const hasError = isRecord(result) && "error" in result;
  if (response.ok && !hasError && accepts(result)) return result;
  if (response.ok && (action === "restore" || action === "upload")) throw unknownOutcome(action);
  const serverError = isRecord(result) && typeof result.error === "string" ? result.error.trim() : "";
  if (!response.ok || hasError) throw new Error(serverError || "备份操作未完成，请重试。");
  throw new Error(action === "export"
    ? "导出响应不完整，尚未确认备份是否保存，请刷新页面核对备份列表。"
    : "备份响应不完整，请重新读取。");
}

async function requestBackup<T>(
  action: Exclude<BackupAction, "upload">,
  accepts: (value: unknown) => value is T,
  fileName?: string,
  discardConfirmation?: string,
  cancellation?: AbortSignal,
): Promise<T> {
  const readOnly = action === "list" || action === "preview";
  const timeout = readOnly ? AbortSignal.timeout(30_000) : undefined;
  const signal = timeout && cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
  try {
    signal?.throwIfAborted();
    const response = await fetch("/api/business-data-backups", {
      method: action === "list" ? "GET" : "POST",
      ...(action === "list" ? { cache: "no-store" } : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, fileName, discardConfirmation }),
      }),
      signal,
    }).catch((caught: unknown) => {
      // 连接中断不能撤销恢复；任何传输拒绝都不能当作服务端未执行。
      if (action === "restore") throw unknownOutcome(action);
      throw caught;
    });
    return await readBackupResponse(response, action, accepts, signal);
  } catch (caught) {
    if (cancellation?.aborted) throw cancellation.reason;
    if (timeout?.aborted) throw new Error("读取超时，请重试。");
    if (caught instanceof TypeError) {
      throw new Error(action === "export"
        ? "连接中断，尚未确认备份是否导出，请刷新页面核对备份列表。"
        : "连接中断，请检查连接后重试。");
    }
    throw caught;
  }
}

export async function requestBackupList(signal: AbortSignal) {
  return (await requestBackup("list", isBackupList, undefined, undefined, signal)).backups;
}

export function requestBackupExport() {
  return requestBackup("export", isBackupExport);
}

export function requestBackupPreview(fileName: string) {
  return requestBackup("preview", isBackupPreview, fileName);
}

export function requestBackupRestore(fileName: string, discardConfirmation?: string) {
  return requestBackup("restore", isBackupPreview, fileName, discardConfirmation);
}

export function readBackupUploadResponse(response: Response) {
  return readBackupResponse(response, "upload", isUploadedBackup);
}
