import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
} from "@/server/auth/session";

const COOKIE_BASE = "Path=/; HttpOnly; SameSite=Strict";
const SESSION_COOKIE_BASE = "Path=/; HttpOnly; SameSite=Lax";

/** Deployment configuration is trusted; forwarded request headers are not. */
function transportAttribute(): string {
  const configured = process.env.PAD_PUBLIC_ORIGIN?.trim();
  if (!configured) return ""; // Default deployment is local HTTP.
  const origin = new URL(configured);
  if (origin.origin !== configured || origin.username || origin.password) throw new Error("PAD_PUBLIC_ORIGIN 必须是纯 origin");
  if (origin.protocol === "https:") return "; Secure";
  if (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return "";
  throw new Error("非本机部署必须使用 HTTPS PAD_PUBLIC_ORIGIN");
}

/** WebAuthn 质询 Cookie：短生命周期，仅服务端可读。 */
export function challengeCookieHeader(challenge: string): string {
  return `${CHALLENGE_COOKIE}=${challenge}; ${COOKIE_BASE}${transportAttribute()}; Max-Age=300`;
}

export function clearChallengeCookieHeader(): string {
  return `${CHALLENGE_COOKIE}=; ${COOKIE_BASE}${transportAttribute()}; Max-Age=0`;
}

/** 会话 Cookie：不设置 Max-Age，浏览器关闭即结束敏感会话。 */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE_BASE}${transportAttribute()}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${SESSION_COOKIE_BASE}${transportAttribute()}; Max-Age=0`;
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
  const url = new URL(process.env.PAD_PUBLIC_ORIGIN?.trim() || request.url);
  return { rpID: url.hostname, origin: url.origin };
}
