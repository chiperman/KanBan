import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

type SecurityChangeResult =
  | { outcome: "confirmed" }
  | { outcome: "rejected" | "unconfirmed"; message: string };

interface PasskeyStatus {
  configured: boolean;
  boundAt: string | null;
  recoveryConfigured: boolean;
}

export interface RecoverySetupOptions {
  secret: string;
  provisioningUri: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSuccess(value: unknown): value is Record<string, unknown> & { ok: true } {
  return isRecord(value) && !("error" in value) && value.ok === true;
}

function serverErrorMessage(value: unknown, fallback: string): string {
  const message = isRecord(value) && typeof value.error === "string" ? value.error.trim() : "";
  return message || fallback;
}

function isPasskeyStatus(value: unknown): value is PasskeyStatus {
  return isRecord(value) && !("error" in value) &&
    typeof value.configured === "boolean" &&
    typeof value.recoveryConfigured === "boolean" &&
    (value.configured
      ? typeof value.boundAt === "string" && Number.isFinite(Date.parse(value.boundAt))
      : value.boundAt === null);
}

function isPasskeyOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return isRecord(value) && !("error" in value) &&
    typeof value.challenge === "string" && /^[A-Za-z0-9_-]+$/u.test(value.challenge) &&
    isRecord(value.rp) && typeof value.rp.name === "string" && value.rp.name.trim() !== "" &&
    isRecord(value.user) && typeof value.user.id === "string" && /^[A-Za-z0-9_-]+$/u.test(value.user.id) &&
    typeof value.user.name === "string" && typeof value.user.displayName === "string" &&
    Array.isArray(value.pubKeyCredParams) && value.pubKeyCredParams.length > 0 &&
    value.pubKeyCredParams.every((param: unknown) =>
      isRecord(param) && param.type === "public-key" && Number.isInteger(param.alg),
    );
}

function isRecoveryOptions(value: unknown): value is RecoverySetupOptions {
  if (!isRecord(value) || "error" in value ||
    typeof value.secret !== "string" || !/^[A-Z2-7]{32}$/u.test(value.secret) ||
    typeof value.provisioningUri !== "string") return false;
  try {
    const uri = new URL(value.provisioningUri);
    return uri.protocol === "otpauth:" && uri.hostname === "totp" &&
      uri.searchParams.get("secret") === value.secret;
  } catch {
    return false;
  }
}

async function readSecuritySetting<T>(
  path: string,
  init: RequestInit,
  valid: (value: unknown) => value is T,
  failureMessage: string,
  { lockSession = false }: { lockSession?: boolean } = {},
): Promise<T> {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(path, { ...init, signal }).catch(() => {
    throw new Error(failureMessage);
  });
  if (response.status === 401) {
    if (lockSession) lockOnUnauthorizedResponse(response);
    throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  }
  if (response.status >= 500) throw new Error(failureMessage);
  const result = await readJsonResult<unknown>(response);
  if (signal.aborted) throw new Error(failureMessage);
  if (!response.ok) throw new Error(serverErrorMessage(result, failureMessage));
  if (!valid(result)) throw new Error(failureMessage);
  return result;
}

async function changeSecuritySetting(
  path: string,
  init: RequestInit,
  {
    rejectedMessage,
    unconfirmedMessage,
    lockSession = false,
  }: { rejectedMessage: string; unconfirmedMessage: string; lockSession?: boolean },
): Promise<SecurityChangeResult> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const response = await fetch(path, { ...init, signal });
    if (response.status === 401) {
      if (lockSession) lockOnUnauthorizedResponse(response);
      return { outcome: "rejected", message: OWNER_SESSION_EXPIRED_MESSAGE };
    }
    if (response.status >= 500) return { outcome: "unconfirmed", message: unconfirmedMessage };
    const result = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    if (!response.ok) {
      return { outcome: "rejected", message: serverErrorMessage(result, rejectedMessage) };
    }
    if (!isSuccess(result)) return { outcome: "unconfirmed", message: unconfirmedMessage };
    return { outcome: "confirmed" };
  } catch {
    return { outcome: "unconfirmed", message: unconfirmedMessage };
  }
}

export function requestPasskeyOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return readSecuritySetting(
    "/api/auth/register/options",
    { method: "POST" },
    isPasskeyOptions,
    "无法开始 Passkey 绑定，尚未更改登录方式；请检查连接后重试。",
  );
}

export function requestPasskeyBinding(attestation: RegistrationResponseJSON): Promise<SecurityChangeResult> {
  return changeSecuritySetting("/api/auth/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attestation),
  }, {
    rejectedMessage: "Passkey 绑定未通过，请重试。",
    unconfirmedMessage: "尚未确认 Passkey 绑定结果，请先重新读取状态，再决定是否重新绑定。",
  });
}

export function requestPasskeyRemoval(): Promise<SecurityChangeResult> {
  return changeSecuritySetting("/api/auth/passkey", { method: "DELETE" }, {
    rejectedMessage: "未能移除 Passkey，请重试。",
    unconfirmedMessage: "尚未确认移除结果，请先重新读取 Passkey 状态。",
  });
}

export function requestPasskeyStatus(): Promise<PasskeyStatus> {
  return readSecuritySetting(
    "/api/auth/passkey",
    { cache: "no-store" },
    isPasskeyStatus,
    "无法读取 Passkey 状态，请检查连接后重试。",
  );
}

export function requestRecoveryOptions(): Promise<RecoverySetupOptions> {
  return readSecuritySetting(
    "/api/auth/recovery/setup",
    { cache: "no-store" },
    isRecoveryOptions,
    "未能获取 TOTP 密钥，请检查连接后重试；现有登录方式未改变。",
    { lockSession: true },
  );
}

export function requestRecoverySave(secret: string, code: string): Promise<SecurityChangeResult> {
  return changeSecuritySetting("/api/auth/recovery/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, code }),
  }, {
    rejectedMessage: "未能保存 TOTP 登录，请检查验证码后重试。",
    unconfirmedMessage: "尚未确认保存结果，请先核对本次密钥；密钥和输入已保留，请勿重新配置或丢弃密钥。",
    lockSession: true,
  });
}

export async function requestRecoveryCheck(secret: string): Promise<boolean> {
  const result = await readSecuritySetting(
    "/api/auth/recovery/setup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check", secret }),
    },
    (value): value is { ok: true; matches: boolean } => isSuccess(value) && typeof value.matches === "boolean",
    "未能核对当前密钥，请检查连接后重试；密钥已保留。",
    { lockSession: true },
  );
  return result.matches;
}
