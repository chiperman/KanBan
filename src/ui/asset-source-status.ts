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
      label: `同步失败 · 数据过期 · 显示 ${lastSuccessfulAt} 的最后成功数据`,
      tone: "error",
    };
  }
  if (source.sync.status === "expired") {
    return {
      label: `数据过期 · 显示 ${lastSuccessfulAt} 的最后成功数据`,
      tone: "warning",
    };
  }
  return null;
}
