"use client";

import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";

/** 所有者主动锁定：销毁服务端会话并重新加载到所有者登录入口。 */
export function LogoutButton({ showLabel = false, tooltipSide = "bottom" }: { showLabel?: boolean; tooltipSide?: "bottom" | "right" }) {
  function lock() {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
  }

  return (
    <VibeTooltip align="end" label="立即锁定敏感内容" side={tooltipSide}>
      <VibeButton
        type="button"
        className={showLabel ? "header-action-button header-lock-button header-lock-button--labeled" : "header-action-button header-lock-button"}
        aria-label="立即锁定（退出登录）"
        onClick={lock}
        variant="outline"
      >
        <VibeIcon name="lock" />
        {showLabel ? <span className="workbench-control-label">锁定</span> : null}
      </VibeButton>
    </VibeTooltip>
  );
}
