"use client";

import type { LongbridgeRealtimeState } from "@/ui/use-longbridge-realtime";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

export function LongbridgeRealtimeStatus({ state }: { state: LongbridgeRealtimeState }) {
  const connecting = state === "idle" || state === "connecting";
  const label = connecting
    ? "正在验证实时行情连接"
    : state === "ready"
      ? "实时行情已连接"
      : state === "reconnecting"
        ? "实时行情重连中"
        : "实时行情不可用";

  return (
    <VibeStatusTag
      aria-atomic="true"
      className="longbridge-realtime-status"
      role="status"
      tone={connecting ? "muted" : state === "ready" ? "success" : state === "reconnecting" ? "warning" : "error"}
    >
      LB / {label}
    </VibeStatusTag>
  );
}

export function LongbridgeRealtimeNotice({ state, retry }: {
  state: LongbridgeRealtimeState;
  retry: () => void;
}) {
  if (state === "idle" || state === "connecting" || state === "ready") return null;
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
        tone="warning"
      >
        <p>实时行情连接中断，正在自动重连。当前页面仍保留已有数据。</p>
        <div className="assets-holdings__realtime-actions">{retryButton}</div>
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
