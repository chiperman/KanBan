"use client";

import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { VibeButton } from "@/ui/vibe/vibe-button";

/** 所有者主动锁定：销毁服务端会话并重新加载到所有者登录入口。 */
export function LogoutButton() {
  function lock() {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
  }

  return (
    <VibeButton
      type="button"
      className="header-action-button header-lock-button"
      aria-label="立即锁定（退出登录）"
      onClick={lock}
      variant="outline"
    >
      立即锁定
    </VibeButton>
  );
}
