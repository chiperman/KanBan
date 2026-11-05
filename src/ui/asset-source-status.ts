import type { AssetSourceSummary, AssetSourceSyncState } from "@/server/ports";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

type SourceWithSync = {
  sync: Pick<AssetSourceSyncState, "status" | "lastSuccessfulAt" | "error" | "diagnostic">;
  kind?: string;
  lifecycle?: "connected" | "disconnected";
};

export function sourceSyncFailureReason(sync: Pick<AssetSourceSyncState, "diagnostic">): string {
  switch (sync.diagnostic?.category) {
    case "network": return "网络连接异常";
    case "timeout": return "请求超时";
    case "rate-limit": return "请求过于频繁，请稍后重试";
    case "server": return "来源服务暂时不可用";
    case "authentication": return "授权不可用";
    case "permission": return "只读权限不足";
    case "restricted": return "来源访问受限";
    case "cancelled": return "同步已取消";
    case "invalid-response": return "来源返回的数据无法识别";
    default: return "原因尚未确认";
  }
}

export function sourceRecoveryAction(source: {
  id: string;
  kind: string;
  lifecycle?: "connected" | "disconnected";
  credentialAvailable?: boolean;
  sync?: Pick<AssetSourceSyncState, "diagnostic">;
}): { label: string; href?: string } {
  const manage = `/asset-sources/${encodeURIComponent(source.id)}?view=manage`;
  const diagnostic = source.sync?.diagnostic;
  if (source.kind === "manual" || source.lifecycle === "disconnected" || source.credentialAvailable === false) {
    return { label: "来源管理", href: manage };
  }
  if (diagnostic?.stage !== "persist" &&
      (diagnostic?.category === "authentication" || diagnostic?.category === "permission")) {
    if (source.kind.startsWith("evm-watch-")) return { label: "来源管理", href: manage };
    if (source.kind === "longbridge" && diagnostic.transport === "cli") {
      return { label: "连接设置", href: `${manage}#source-connection-heading` };
    }
    return { label: "连接设置", href: `/asset-sources/${encodeURIComponent(source.id)}/reauthorize` };
  }
  if (diagnostic?.retryable && ["network", "timeout", "rate-limit", "server"].includes(diagnostic.category)) {
    return { label: "重试" };
  }
  return { label: "来源管理", href: manage };
}

export function sourceSummaryStatus(source: Pick<AssetSourceSummary, "kind" | "lifecycle" | "hasManualRecord" | "sync">) {
  if (source.lifecycle === "disconnected") return { label: "已断开", tone: "muted" as const };
  if (source.kind === "manual") return source.hasManualRecord === false
    ? { label: "待记录", tone: "warning" as const }
    : { label: "手工记录", tone: "muted" as const };
  const problem = sourceSyncStatus(source);
  if (problem) return { label: source.sync.error !== null ? "同步失败" : "待更新", tone: problem.tone };
  return { label: "已连接", tone: "success" as const };
}

export type SourceSyncStatus = {
  label: string;
  tone: "error" | "warning";
};

export function sourceSyncStatus(
  source: SourceWithSync,
): SourceSyncStatus | null {
  if (source.kind === "manual" || source.lifecycle === "disconnected") return null;
  const retained = Number.isFinite(Date.parse(source.sync.lastSuccessfulAt))
    ? `当前显示 ${formatShanghaiDateTime(source.sync.lastSuccessfulAt)} 的资产数据`
    : "保留已有资产数据，最近成功时间未知";
  if (source.sync.error !== null) {
    return {
      label: `同步失败：${sourceSyncFailureReason(source.sync)}。${retained}`,
      tone: "error",
    };
  }
  if (source.sync.status === "expired") {
    return {
      label: `资产待更新，${retained}`,
      tone: "warning",
    };
  }
  return null;
}
