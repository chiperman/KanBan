import type { LongbridgeConnections } from "@/server/asset-sources/longbridge-connections";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export type ConnectionStatus = Awaited<ReturnType<LongbridgeConnections["status"]>>;
type CliStatus = ConnectionStatus["cli"];

export class ConnectionStatusReadError extends Error {
  constructor(message: string, readonly clearSnapshot = false) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCliStatus(value: unknown): value is CliStatus {
  return isRecord(value) &&
    typeof value.installed === "boolean" &&
    isNullableString(value.version) &&
    typeof value.authorized === "boolean" &&
    isNullableString(value.account) &&
    typeof value.matches === "boolean" &&
    isNullableString(value.error);
}

function isConnectionStatus(value: unknown): value is ConnectionStatus {
  if (!isRecord(value) || !isCliStatus(value.cli) || !isRecord(value.sdk)) return false;
  const sdk = value.sdk;
  const lastUsed = value.lastUsed;
  return (value.mode === "cli" || value.mode === "sdk" || value.mode === "both") &&
    isNullableString(value.account) &&
    (lastUsed === null || (
      isRecord(lastUsed) &&
      (lastUsed.transport === "cli" || lastUsed.transport === "sdk") &&
      typeof lastUsed.fallback === "boolean" &&
      typeof lastUsed.at === "string"
    )) &&
    typeof sdk.authorized === "boolean" &&
    (sdk.account === undefined || typeof sdk.account === "string") &&
    (sdk.matches === undefined || typeof sdk.matches === "boolean") &&
    (sdk.error === undefined || typeof sdk.error === "string");
}

async function readConnectionStatus<T>(
  sourceId: string | undefined,
  transport: "all" | "cli",
  accepts: (value: unknown) => value is T,
  cancellation: AbortSignal,
): Promise<T> {
  const label = transport === "cli" ? "CLI 检测" : "长桥连接检测";
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60_000)]);
  try {
    signal.throwIfAborted();
    const query = new URLSearchParams();
    if (sourceId) query.set("sourceId", sourceId);
    if (transport === "cli") query.set("transport", "cli");
    const response = await fetch(
      `/api/asset-sources/longbridge/connection${query.size ? `?${query}` : ""}`,
      { cache: "no-store", signal },
    );
    if (lockOnUnauthorizedResponse(response)) {
      throw new ConnectionStatusReadError(OWNER_SESSION_EXPIRED_MESSAGE, true);
    }
    if (response.status === 403 || response.status === 404) {
      throw new ConnectionStatusReadError("无法访问长桥连接状态，请重新打开连接设置。", true);
    }
    const body = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    const serverError = isRecord(body) && typeof body.error === "string" ? body.error.trim() : "";
    if (!response.ok || serverError) throw new ConnectionStatusReadError(serverError || `${label}失败，请重新检测。`);
    if (!accepts(body)) throw new ConnectionStatusReadError(`${label}返回的数据不完整，请重新检测。`);
    return body;
  } catch (caught) {
    if (cancellation.aborted) throw cancellation.reason;
    if (signal.aborted) throw new ConnectionStatusReadError(`${label}超时，请重新检测。`);
    if (caught instanceof TypeError) throw new ConnectionStatusReadError("连接中断，请检查连接后重新检测。");
    throw caught;
  }
}

export function requestLongbridgeConnectionStatus(sourceId: string | undefined, signal: AbortSignal) {
  return readConnectionStatus(sourceId, "all", isConnectionStatus, signal);
}

export async function requestLongbridgeCliStatus(sourceId: string | undefined, signal: AbortSignal) {
  const body = await readConnectionStatus(
    sourceId,
    "cli",
    (value): value is { cli: CliStatus } => isRecord(value) && isCliStatus(value.cli),
    signal,
  );
  return body.cli;
}

export type CliLoginResult =
  | { outcome: "accepted" }
  | { outcome: "rejected" | "unconfirmed"; message: string };

/** 中断等待不能撤销服务端登录；未确认的结果只能通过只读检测核对。 */
export async function requestLongbridgeCliLogin(code: string, cancellation: AbortSignal): Promise<CliLoginResult> {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(60_000)]);
  try {
    signal.throwIfAborted();
    const response = await fetch("/api/asset-sources/longbridge/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal,
    });
    if (lockOnUnauthorizedResponse(response)) {
      return { outcome: "rejected", message: OWNER_SESSION_EXPIRED_MESSAGE };
    }
    if (response.status >= 500) {
      return { outcome: "unconfirmed", message: "服务端未能确认 CLI 登录结果。" };
    }
    const body = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    const serverError = isRecord(body) && typeof body.error === "string" ? body.error.trim() : "";
    if (!response.ok) {
      return { outcome: "rejected", message: serverError || "CLI 登录未完成，请重新获取授权码。" };
    }
    if (!isRecord(body) || body.ok !== true || "error" in body) {
      return { outcome: "unconfirmed", message: "CLI 登录响应不完整，结果尚未确认。" };
    }
    return { outcome: "accepted" };
  } catch {
    if (cancellation.aborted) throw cancellation.reason;
    return {
      outcome: "unconfirmed",
      message: signal.aborted ? "CLI 登录等待超时，结果尚未确认。" : "连接中断，CLI 登录结果尚未确认。",
    };
  }
}
