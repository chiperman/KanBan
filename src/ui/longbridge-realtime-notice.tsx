"use client";

import type { LongbridgeRealtimeState } from "@/ui/use-longbridge-realtime";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
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
      长桥{label}
    </VibeStatusTag>
  );
}

export function LongbridgeRealtimeNotice({ state, retry, sourceId }: {
  state: LongbridgeRealtimeState;
  retry: () => void;
  sourceId?: string;
}) {
  if (state === "idle" || state === "connecting" || state === "ready") return null;
  const message = state === "authentication-required"
    ? <>长桥实时行情需要 CLI 登录。在此电脑运行 <code>longbridge auth login</code> 后重试。当前保留已有数据。</>
    : state === "cli-unavailable"
      ? "未找到 Longbridge CLI。安装并完成连接配置后重试，当前保留已有数据。"
      : state === "reconnecting"
        ? "实时行情中断，正在重连。当前显示已有数据。"
        : "长桥实时行情不可用，当前显示最近一次完整数据。";
  return (
    <VibeNotice
      className="assets-holdings__realtime-notice"
      role={state === "reconnecting" ? "status" : "alert"}
      tone={state === "reconnecting" ? "warning" : "error"}
    >
      <p>{message}</p>
      <div className="assets-holdings__realtime-actions">
        <VibeButton onClick={retry} type="button" variant="outline">重试连接</VibeButton>
        <VibeLink href={sourceId
          ? `/asset-sources/${encodeURIComponent(sourceId)}?view=manage#source-connection-heading`
          : "/settings?view=data#asset-sources"} variant="text">行情连接设置</VibeLink>
      </div>
    </VibeNotice>
  );
}
