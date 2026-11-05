import { OWNER_LOCK_EVENT } from "@/shared/session-policy";

/** 受保护业务请求被拒绝时，与资产刷新一致的即时本地锁定行为。 */
export const OWNER_SESSION_EXPIRED_MESSAGE = "所有者会话已失效";

/**
 * 业务请求返回 401 时立即广播所有者锁定，让 `SessionGuard` 同步收起敏感内容。
 * 仅用于受保护业务请求；登录、TOTP、Passkey 与恢复接口的失败语义保持各自处理。
 */
export function lockOnUnauthorizedResponse(response: Response): boolean {
  if (response.status !== 401) return false;
  window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
  return true;
}

/** 读取 JSON 失败或句柄被驳回时返回 null，调用方据此给出兜底文案。 */
export async function readJsonResult<T>(response: Response): Promise<T | null> {
  return await response.json().catch(() => null) as T | null;
}
