"use client";

import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDotIcon } from "@/ui/vibe/vibe-dot-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";

/** 所有者主动锁定：销毁服务端会话并重新加载到所有者登录入口。 */
export function LogoutButton({ showLabel = false }: { showLabel?: boolean }) {
  function lock() {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
  }

  return (
    <VibeTooltip align="end" label="立即锁定敏感内容">
      <VibeButton
        type="button"
        className={showLabel ? "header-action-button header-lock-button header-lock-button--labeled" : "header-action-button header-lock-button"}
        aria-label="立即锁定（退出登录）"
        onClick={lock}
        variant="outline"
      >
        {showLabel ? <span>锁定</span> : null}
        <VibeDotIcon name="lock" size={24} />
      </VibeButton>
    </VibeTooltip>
  );
}
