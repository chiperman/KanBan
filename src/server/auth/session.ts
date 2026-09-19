import { clearChallenges } from "@/server/auth/challenges";
import { randomUUID } from "node:crypto";

import type { OwnerSession } from "@/server/ports";
import { SESSION_IDLE_TIMEOUT_MS } from "@/shared/session-policy";

/**
 * 所有者会话存储：仅驻留服务端内存。
 * 会话 Cookie 不设置过期时间，浏览器关闭即结束；服务重启同样要求重新验证。
 */

export const SESSION_COOKIE = "pad_session";
export const CHALLENGE_COOKIE = "pad_webauthn_challenge";
const RECOVERY_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;

const GLOBAL_KEY = "__personal_asset_dashboard_sessions__";

interface FailureWindow {
  failedAttempts: number;
  expiresAt: Date;
}

type SessionSlot = {
  sessions: Map<string, OwnerSession>;
  recoveryTotpFailures: FailureWindow | null;
};

function slot(): SessionSlot {
  const globalScope = globalThis as unknown as Record<
    string,
    SessionSlot | undefined
  >;
  globalScope[GLOBAL_KEY] ??= {
    sessions: new Map(),
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
  successful: boolean,
  now: Date,
): boolean {
  if (!canAttemptRecoveryTotp(now)) return false;
  if (successful) {
    slot().recoveryTotpFailures = null;
    return true;
  }

  const failures = slot().recoveryTotpFailures;
  if (!failures) {
    slot().recoveryTotpFailures = {
      failedAttempts: 1,
      expiresAt: new Date(now.getTime() + RECOVERY_FAILURE_WINDOW_MS),
    };
  } else {
    failures.failedAttempts += 1;
    if (failures.failedAttempts >= RECOVERY_MAX_ATTEMPTS) {
      failures.expiresAt = new Date(
        now.getTime() + RECOVERY_FAILURE_WINDOW_MS,
      );
    }
  }
  return false;
}

/** 测试重置时清空全部会话，保证每条浏览器测试从锁定状态开始。 */
export function clearAllSessions(): void {
  clearChallenges();
  slot().sessions.clear();
  slot().recoveryTotpFailures = null;
}
