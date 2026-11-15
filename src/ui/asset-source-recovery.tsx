"use client";

import type { RefreshableAssetSource } from "@/ui/asset-refresh-coordinator";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { sourceRecoveryAction, sourceSyncFailureReason } from "@/ui/asset-source-status";
import { formatShanghaiShortDateTime } from "@/ui/shanghai-date-time";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";

export function AssetSourceRecoveryAction({ source, emphasis = false, hideManageLink = false }: {
  source: RefreshableAssetSource;
  emphasis?: boolean;
  hideManageLink?: boolean;
}) {
  const refresh = useAssetRefresh();
  const current = refresh.failedSources.find(item => item.id === source.id) ?? source;
  const action = sourceRecoveryAction(current);
  if (hideManageLink && action.href === `/asset-sources/${encodeURIComponent(source.id)}?view=manage`) return null;
  if (action.href) return <VibeLink href={action.href} variant={emphasis ? "outline" : "text"} size="compact">{action.label}</VibeLink>;
  const pending = refresh.sourceStatus(source.id).state === "refreshing";
  return <VibeButton
    aria-label={`重试刷新 ${source.displayName ?? source.id}`}
    aria-busy={pending}
    disabled={pending}
    onClick={() => void refresh.request({ reason: "manual-source", sourceId: source.id })}
    type="button" variant={emphasis ? "outline" : "text"} size="compact"
  >{pending ? "重试中…" : action.label}</VibeButton>;
}

function issueDetail(source: RefreshableAssetSource): string {
  const reason = source.sync?.error != null
    ? sourceSyncFailureReason(source.sync)
    : source.sync?.status === "expired" ? "数据待更新" : "刷新未完成";
  const lastSuccess = source.sync?.lastSuccessfulAt;
  return lastSuccess !== undefined && Number.isFinite(Date.parse(lastSuccess))
    ? `${reason}，数据截至 ${formatShanghaiShortDateTime(lastSuccess)}`
    : reason;
}

export function AssetRefreshIssues({ hideSourceNames = false }: { hideSourceNames?: boolean }) {
  const refresh = useAssetRefresh();
  const failed = refresh.failedSources;
  if (failed.length === 0) return null;
  return <div className="asset-refresh-issues">
    {hideSourceNames ? <p>{failed.length} 个来源未更新，详情已隐藏。</p> : <ul aria-label="未更新的资产来源">
      {failed.map(source => <li key={source.id}>
        <div className="asset-refresh-issues__source">
          <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}?view=manage`}>
            {source.displayName ?? source.id}
          </VibeEntityLink>
          <p>{issueDetail(source)}</p>
        </div>
        <AssetSourceRecoveryAction emphasis source={source} />
      </li>)}
    </ul>}
  </div>;
}
