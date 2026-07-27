import {
  CHALLENGE_COOKIE,
  RECOVERY_PENDING_COOKIE,
  SESSION_COOKIE,
} from "@/server/auth/session";

const COOKIE_BASE = "Path=/; HttpOnly; SameSite=Strict";
const SESSION_COOKIE_BASE = "Path=/; HttpOnly; SameSite=Lax";

/** WebAuthn 质询 Cookie：短生命周期，仅服务端可读。 */
export function challengeCookieHeader(challenge: string): string {
  return `${CHALLENGE_COOKIE}=${challenge}; ${COOKIE_BASE}; Max-Age=300`;
}

export function clearChallengeCookieHeader(): string {
  return `${CHALLENGE_COOKIE}=; ${COOKIE_BASE}; Max-Age=0`;
}

/** 会话 Cookie：不设置 Max-Age，浏览器关闭即结束敏感会话。 */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE_BASE}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${SESSION_COOKIE_BASE}; Max-Age=0`;
}

export function recoveryPendingCookieHeader(token: string): string {
  return `${RECOVERY_PENDING_COOKIE}=${token}; ${COOKIE_BASE}; Max-Age=300`;
}

export function clearRecoveryPendingCookieHeader(): string {
  return `${RECOVERY_PENDING_COOKIE}=; ${COOKIE_BASE}; Max-Age=0`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** 从请求推导 WebAuthn 依赖的 rpID 与 origin，保证与当前访问入口一致。 */
export function relyingParty(request: Request): {
  rpID: string;
  origin: string;
} {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}
