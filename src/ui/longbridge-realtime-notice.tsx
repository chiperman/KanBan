"use client";

import type { LongbridgeRealtimeState } from "@/ui/use-longbridge-realtime";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

export function LongbridgeRealtimeNotice({ state, retry }: {
  state: LongbridgeRealtimeState;
  retry: () => void;
}) {
  if (state === "idle" || state === "ready") return null;
  const retryButton = (
    <VibeButton
      onClick={retry}
      type="button"
      variant="outline"
    >
      重新检测
    </VibeButton>
  );
  if (state === "authentication-required") {
    return (
      <VibeNotice
        className="assets-holdings__realtime-notice"
        code="LONGBRIDGE / LOGIN"
        role="alert"
        tone="error"
      >
        <p>未检测到当前电脑的 Longbridge CLI 登录状态。请先完成一次 <code>longbridge auth login</code>，然后回到这里重新检测。</p>
        <div className="assets-holdings__realtime-actions">{retryButton}</div>
      </VibeNotice>
    );
  }
  if (state === "cli-unavailable") {
    return (
      <VibeNotice
        className="assets-holdings__realtime-notice"
        code="LONGBRIDGE / CLI"
        role="alert"
        tone="error"
      >
        <p>未找到 Longbridge CLI，暂时无法建立实时行情连接。请安装或配置 CLI 后重新检测。</p>
        <div className="assets-holdings__realtime-actions">{retryButton}</div>
      </VibeNotice>
    );
  }
  if (state === "reconnecting") {
    return (
      <VibeNotice
        className="assets-holdings__realtime-notice"
        code="LONGBRIDGE / RECONNECTING"
        role="status"
        tone="info"
      >
        <p>实时行情连接中断，正在自动重连。当前页面仍保留已有数据。</p>
        <div className="assets-holdings__realtime-actions">{retryButton}</div>
      </VibeNotice>
    );
  }
  if (state === "connecting") {
    return (
      <VibeNotice
        className="assets-holdings__realtime-notice"
        code="LONGBRIDGE / CONNECTING"
        role="status"
        tone="info"
      >
        正在验证长桥实时行情连接…
      </VibeNotice>
    );
  }
  return (
    <VibeNotice
      className="assets-holdings__realtime-notice"
      code="LONGBRIDGE / UNAVAILABLE"
      role="alert"
      tone="error"
    >
      <p>长桥实时行情暂时不可用。当前页面仍可查看最近一次完整数据。</p>
      <div className="assets-holdings__realtime-actions">{retryButton}</div>
    </VibeNotice>
  );
}
