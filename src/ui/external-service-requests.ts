import type {
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
  ExternalServiceConnectionStatus,
} from "@/server/ports";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

type ServiceSaveResult =
  | { outcome: "confirmed"; status: ExternalServiceConfigurationStatus }
  | { outcome: "rejected" | "unconfirmed"; message: string };

const UNCONFIRMED_MESSAGE = "尚未确认服务配置是否保存。请先核对服务状态，再决定是否重新保存；输入已保留。";
const READ_FAILURE_MESSAGE = "未能读取服务状态，请重试核对。输入已保留。";
const READ_TIMEOUT_MESSAGE = "核对服务状态超时，请重试核对。输入与上次状态已保留。";
const READ_NETWORK_MESSAGE = "网络连接异常，尚未核对服务状态，请重试核对。输入已保留。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServiceStatus(value: unknown): value is ExternalServiceConnectionStatus {
  return isRecord(value) && typeof value.configured === "boolean" && (
    value.verifiedAt === null ||
    (typeof value.verifiedAt === "string" && Number.isFinite(Date.parse(value.verifiedAt)))
  );
}

function isConfigurationStatus(value: unknown): value is ExternalServiceConfigurationStatus {
  return isRecord(value) && !("error" in value) &&
    isServiceStatus(value.coinGecko) &&
    isServiceStatus(value.ethereumRpc) &&
    isServiceStatus(value.bscRpc);
}

export async function requestExternalServiceSave(
  input: ExternalServiceConfigurationInput,
): Promise<ServiceSaveResult> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const response = await fetch("/api/external-services", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (lockOnUnauthorizedResponse(response)) {
      return { outcome: "rejected", message: OWNER_SESSION_EXPIRED_MESSAGE };
    }
    if (response.status >= 500) return { outcome: "unconfirmed", message: UNCONFIRMED_MESSAGE };
    const result = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    if (!response.ok) {
      const serverError = isRecord(result) && typeof result.error === "string" ? result.error.trim() : "";
      return { outcome: "rejected", message: serverError || "外部服务保存失败，请重试。" };
    }
    // 保存接口会验证全部三个服务；只读状态的「未配置」不能充当保存确认。
    if (!isConfigurationStatus(result) || ![
      result.coinGecko, result.ethereumRpc, result.bscRpc,
    ].every((service) => service.configured && service.verifiedAt !== null)) {
      return { outcome: "unconfirmed", message: UNCONFIRMED_MESSAGE };
    }
    return { outcome: "confirmed", status: result };
  } catch {
    return { outcome: "unconfirmed", message: UNCONFIRMED_MESSAGE };
  }
}

export async function requestExternalServiceStatus(): Promise<ExternalServiceConfigurationStatus> {
  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch("/api/external-services", { cache: "no-store", signal });
  } catch {
    throw new Error(signal.aborted ? READ_TIMEOUT_MESSAGE : READ_NETWORK_MESSAGE);
  }
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok) throw new Error(READ_FAILURE_MESSAGE);
  const result = await readJsonResult<unknown>(response);
  if (signal.aborted) throw new Error(READ_TIMEOUT_MESSAGE);
  if (!isConfigurationStatus(result)) throw new Error(READ_FAILURE_MESSAGE);
  return result;
}
