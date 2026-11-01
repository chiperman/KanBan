import type { ManualAssetClass } from "@/server/ports";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export type AssetSourceSettingCommand =
  | { action: "rename"; displayName: string }
  | { action: "manual-asset-class"; manualAssetClass: ManualAssetClass | null }
  | {
    action: "evm-token-preference";
    assetKeys: string[];
    status: "included" | "ignored" | "unrecognized";
  };

export type AssetSourceCommand =
  | AssetSourceSettingCommand
  | { action: "disconnect" | "restore" }
  | { action: "delete-source-data"; confirmation: "DELETE_SOURCE_DATA" }
  | { action: "delete-manual-record"; day: string };

export type AssetSourceCommandResult =
  | { outcome: "confirmed" }
  | { outcome: "rejected"; message: string }
  | { outcome: "unconfirmed"; message: string };

const COMMAND_FEEDBACK = {
  rename: {
    rejected: "保存名称失败，请重试。",
    unconfirmed: "尚未确认名称是否保存。请先在新标签页核对当前设置，确认未保存后再重试。",
  },
  "manual-asset-class": {
    rejected: "保存类别失败，请重试。",
    unconfirmed: "尚未确认类别是否保存。请先在新标签页核对当前设置，确认未保存后再重试。",
  },
  "evm-token-preference": {
    rejected: "保存资产范围失败，请重试。",
    unconfirmed: "尚未确认资产范围是否保存。请先在新标签页核对当前设置，确认未保存后再重试。",
  },
  disconnect: {
    rejected: "断开来源失败，请重试。",
    unconfirmed: "尚未确认是否断开。请先在新标签页核对来源状态，确认未断开后再重新操作。",
  },
  restore: {
    rejected: "恢复连接失败，请重试。",
    unconfirmed: "尚未确认是否恢复连接。请先在新标签页核对来源状态，确认未恢复后再重新操作。",
  },
  "delete-source-data": {
    rejected: "删除来源数据失败，请重试。",
    unconfirmed: "尚未确认来源是否删除。请先在新标签页核对来源列表，确认仍存在后再重新发起删除。",
  },
  "delete-manual-record": {
    rejected: "删除记录失败，请重试。",
    unconfirmed: "尚未确认该日记录是否删除。请先在新标签页核对最新记录，确认仍存在后再重新操作。",
  },
} satisfies Record<AssetSourceCommand["action"], { rejected: string; unconfirmed: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function requestAssetSourceCommand(
  sourceId: string,
  command: AssetSourceCommand,
  cancellation: AbortSignal,
): Promise<AssetSourceCommandResult> {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(30_000)]);
  const feedback = COMMAND_FEEDBACK[command.action];
  const unconfirmed = {
    outcome: "unconfirmed",
    message: feedback.unconfirmed,
  } as const;
  const deleting = command.action === "delete-source-data" || command.action === "delete-manual-record";
  const body = command.action === "delete-source-data"
    ? { confirmation: command.confirmation }
    : command.action === "delete-manual-record"
      ? { action: "manual-record", day: command.day }
      : command;
  try {
    const response = await fetch(`/api/asset-sources/${encodeURIComponent(sourceId)}`, {
      method: deleting ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (lockOnUnauthorizedResponse(response)) {
      return { outcome: "rejected", message: OWNER_SESSION_EXPIRED_MESSAGE };
    }
    if (response.status >= 500) return unconfirmed;
    const result = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    if (response.status >= 400 && response.status < 500) {
      const error = isRecord(result) && typeof result.error === "string" ? result.error.trim() : "";
      return { outcome: "rejected", message: error || feedback.rejected };
    }
    if (!response.ok || !isRecord(result) || result.ok !== true || "error" in result) {
      return unconfirmed;
    }
    return { outcome: "confirmed" };
  } catch {
    return unconfirmed;
  }
}
