import { randomUUID } from "node:crypto";

import type { OwnerSession } from "@/server/ports";

/**
 * 所有者会话存储：仅驻留服务端内存。
 * 会话 Cookie 不设置过期时间，浏览器关闭即结束；服务重启同样要求重新验证。
 */

export const SESSION_COOKIE = "pad_session";
export const CHALLENGE_COOKIE = "pad_webauthn_challenge";

const GLOBAL_KEY = "__personal_asset_dashboard_sessions__";

type SessionSlot = { sessions: Map<string, OwnerSession> };

function slot(): SessionSlot {
  const globalScope = globalThis as unknown as Record<
    string,
    SessionSlot | undefined
  >;
  globalScope[GLOBAL_KEY] ??= { sessions: new Map() };
  return globalScope[GLOBAL_KEY];
}

export function createSession(ownerId: string): string {
  const token = randomUUID();
  slot().sessions.set(token, { ownerId, authenticatedAt: new Date() });
  return token;
}

export function lookupSession(token: string): OwnerSession | null {
  return slot().sessions.get(token) ?? null;
}

export function destroySession(token: string): void {
  slot().sessions.delete(token);
}

/** 测试重置时清空全部会话，保证每条浏览器测试从访客状态开始。 */
export function clearAllSessions(): void {
  slot().sessions.clear();
}
