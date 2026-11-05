import { cookies } from "next/headers";

import type { Clock, OwnerAuth, OwnerSession } from "@/server/ports";
import { SESSION_COOKIE, lookupSession } from "@/server/auth/session";

/**
 * 基于服务端会话的所有者身份认证。
 * 生产与测试环境共用同一实现：测试通过浏览器级虚拟 Passkey 走真实登录流程。
 */
export class SessionOwnerAuth implements OwnerAuth {
  constructor(private readonly clock: Clock) {}

  async currentSession(): Promise<OwnerSession | null> {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return lookupSession(token, this.clock.now());
  }
}
