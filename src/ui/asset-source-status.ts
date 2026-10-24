import type { AssetSourceSummary } from "@/server/ports";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

type SourceWithSync = Pick<AssetSourceSummary, "sync">;

export type SourceSyncStatus = {
  label: string;
  tone: "error" | "warning";
};

export function sourceSyncStatus(
  source: SourceWithSync,
): SourceSyncStatus | null {
  const lastSuccessfulAt = formatShanghaiDateTime(source.sync.lastSuccessfulAt);
  if (source.sync.error !== null) {
    return {
      label: `同步失败：${source.sync.error === "资产来源同步失败" ? "原因未记录" : source.sync.error}。当前显示 ${lastSuccessfulAt} 的资产数据`,
      tone: "error",
    };
  }
  if (source.sync.status === "expired") {
    return {
      label: `资产待更新，当前显示 ${lastSuccessfulAt} 的资产数据`,
      tone: "warning",
    };
  }
  return null;
}
