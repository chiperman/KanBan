import type { ManualAssetRecordInput } from "@/domain/manual-asset-records";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export class RecordSaveOutcomeUnknown extends Error {
  constructor() {
    super("尚未确认保存结果。请在新标签页核对最新记录，确认未保存后再重试；当前输入已保留。");
  }
}

async function saveRecordRequest(
  url: string,
  { method, body, failureMessage, cancellation }: {
    method: "POST" | "PATCH";
    body: object;
    failureMessage: string;
    cancellation: AbortSignal;
  },
) {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(30_000)]);
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new RecordSaveOutcomeUnknown();
  }
  if (cancellation.aborted) throw new RecordSaveOutcomeUnknown();
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (response.status >= 500) throw new RecordSaveOutcomeUnknown();
  const result = await readJsonResult<unknown>(response);
  if (signal.aborted) throw new RecordSaveOutcomeUnknown();
  const payload = result !== null && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
  if (response.status >= 400 && response.status < 500) {
    const message = typeof payload?.error === "string" ? payload.error.trim() : "";
    throw new Error(message || failureMessage);
  }
  if (!response.ok || payload?.ok !== true || "error" in payload)
    throw new RecordSaveOutcomeUnknown();
}

export function bookRequest(body: object, cancellation: AbortSignal) {
  return saveRecordRequest("/api/investment-books", {
    method: "POST",
    body,
    failureMessage: "账本保存失败",
    cancellation,
  });
}

export function manualAssetRecordRequest(sourceId: string, input: ManualAssetRecordInput, cancellation: AbortSignal) {
  return saveRecordRequest(`/api/asset-sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body: { action: "manual-record", ...input },
    failureMessage: "保存记录失败",
    cancellation,
  });
}
