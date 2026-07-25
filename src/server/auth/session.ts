import { randomUUID } from "node:crypto";

import type { OwnerSession } from "@/server/ports";
import { SESSION_IDLE_TIMEOUT_MS } from "@/shared/session-policy";

/**
 * 所有者会话存储：仅驻留服务端内存。
 * 会话 Cookie 不设置过期时间，浏览器关闭即结束；服务重启同样要求重新验证。
 */

export const SESSION_COOKIE = "pad_session";
export const CHALLENGE_COOKIE = "pad_webauthn_challenge";
export const RECOVERY_PENDING_COOKIE = "pad_recovery_pending";
const RECOVERY_PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;

const GLOBAL_KEY = "__personal_asset_dashboard_sessions__";

interface PendingRecovery {
  ownerId: string;
  totpSecret: string;
  expiresAt: Date;
}

interface FailureWindow {
  failedAttempts: number;
  expiresAt: Date;
}

type SessionSlot = {
  sessions: Map<string, OwnerSession>;
  pendingRecoveries: Map<string, PendingRecovery>;
  recoveryPasswordFailures: FailureWindow | null;
  recoveryTotpFailures: FailureWindow | null;
};

function slot(): SessionSlot {
  const globalScope = globalThis as unknown as Record<
    string,
    SessionSlot | undefined
  >;
  globalScope[GLOBAL_KEY] ??= {
    sessions: new Map(),
    pendingRecoveries: new Map(),
    recoveryPasswordFailures: null,
    recoveryTotpFailures: null,
  };
  return globalScope[GLOBAL_KEY];
}

export function createSession(ownerId: string, now: Date): string {
  const token = randomUUID();
  slot().sessions.set(token, {
    ownerId,
    authenticatedAt: now,
    lastActivityAt: now,
  });
  return token;
}

export function lookupSession(token: string, now: Date): OwnerSession | null {
  const session = slot().sessions.get(token);
  if (!session) return null;
  if (
    now.getTime() - session.lastActivityAt.getTime() >=
    SESSION_IDLE_TIMEOUT_MS
  ) {
    slot().sessions.delete(token);
    return null;
  }
  return session;
}

export function touchSession(token: string, now: Date): boolean {
  const session = lookupSession(token, now);
  if (!session) return false;
  session.lastActivityAt = now;
  return true;
}

export function destroySession(token: string): void {
  slot().sessions.delete(token);
}

export function createPendingRecovery(
  ownerId: string,
  totpSecret: string,
  now: Date,
): string {
  const token = randomUUID();
  slot().pendingRecoveries.set(token, {
    ownerId,
    totpSecret,
    expiresAt: new Date(now.getTime() + RECOVERY_PENDING_TIMEOUT_MS),
  });
  return token;
}

function canAttemptWithinWindow(
  failures: FailureWindow | null,
  now: Date,
): boolean {
  return (
    failures === null ||
    now.getTime() >= failures.expiresAt.getTime() ||
    failures.failedAttempts < RECOVERY_MAX_ATTEMPTS
  );
}

export function canAttemptRecoveryTotp(now: Date): boolean {
  const current = slot().recoveryTotpFailures;
  if (!canAttemptWithinWindow(current, now)) return false;
  if (current && now.getTime() >= current.expiresAt.getTime()) {
    slot().recoveryTotpFailures = null;
  }
  return true;
}

export function completeRecoveryTotpAttempt(
  token: string,
  successful: boolean,
  now: Date,
): PendingRecovery | null {
  if (!canAttemptRecoveryTotp(now)) return null;
  const pending = lookupPendingRecovery(token, now);
  if (!pending) return null;
  if (successful) {
    slot().pendingRecoveries.delete(token);
    slot().recoveryTotpFailures = null;
    return pending;
  }

  const failures = slot().recoveryTotpFailures;
  if (!failures) {
    slot().recoveryTotpFailures = {
      failedAttempts: 1,
      expiresAt: new Date(now.getTime() + RECOVERY_PENDING_TIMEOUT_MS),
    };
  } else {
    failures.failedAttempts += 1;
  }
  if (!canAttemptRecoveryTotp(now)) {
    slot().pendingRecoveries.clear();
  }
  return null;
}

export type RecoveryPasswordAttempt =
  | "allowed"
  | "password-limited"
  | "totp-limited";

export function claimRecoveryPasswordAttempt(
  now: Date,
): RecoveryPasswordAttempt {
  if (!canAttemptRecoveryTotp(now)) return "totp-limited";
  const failures = slot().recoveryPasswordFailures;
  if (!canAttemptWithinWindow(failures, now)) return "password-limited";
  if (failures && now.getTime() >= failures.expiresAt.getTime()) {
    slot().recoveryPasswordFailures = null;
  }
  const current = slot().recoveryPasswordFailures;
  if (!current) {
    slot().recoveryPasswordFailures = {
      failedAttempts: 1,
      expiresAt: new Date(now.getTime() + RECOVERY_PENDING_TIMEOUT_MS),
    };
  } else {
    current.failedAttempts += 1;
  }
  return "allowed";
}

export function clearRecoveryPasswordFailures(): void {
  slot().recoveryPasswordFailures = null;
}

export function lookupPendingRecovery(
  token: string,
  now: Date,
): PendingRecovery | null {
  const pending = slot().pendingRecoveries.get(token);
  if (!pending) return null;
  if (now.getTime() >= pending.expiresAt.getTime()) {
    slot().pendingRecoveries.delete(token);
    return null;
  }
  return pending;
}

export function destroyPendingRecovery(token: string): void {
  slot().pendingRecoveries.delete(token);
}

/** 测试重置时清空全部会话，保证每条浏览器测试从访客状态开始。 */
export function clearAllSessions(): void {
  slot().sessions.clear();
  slot().pendingRecoveries.clear();
  slot().recoveryPasswordFailures = null;
  slot().recoveryTotpFailures = null;
}
