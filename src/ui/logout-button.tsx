"use client";

import { OWNER_LOCK_EVENT } from "@/shared/session-policy";

/** 所有者主动锁定：销毁服务端会话并重新加载到所有者登录入口。 */
export function LogoutButton() {
  function lock() {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
  }

  return (
    <button
      type="button"
      className="logout-button"
      aria-label="立即锁定（退出登录）"
      onClick={lock}
    >
      立即锁定
    </button>
  );
}
