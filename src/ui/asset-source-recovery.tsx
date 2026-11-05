"use client";

import type { RefreshableAssetSource } from "@/ui/asset-refresh-coordinator";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { sourceRecoveryAction, sourceSyncStatus } from "@/ui/asset-source-status";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";

export function AssetSourceRecoveryAction({ source, hideManageLink = false }: {
  source: RefreshableAssetSource;
  hideManageLink?: boolean;
}) {
  const refresh = useAssetRefresh();
  const current = refresh.failedSources.find(item => item.id === source.id) ?? source;
  const action = sourceRecoveryAction(current);
  if (hideManageLink && action.href === `/asset-sources/${encodeURIComponent(source.id)}?view=manage`) return null;
  if (action.href) return <VibeLink href={action.href} variant="text" size="compact">{action.label}</VibeLink>;
  const pending = refresh.sourceStatus(source.id).state === "refreshing";
  return <VibeButton
    aria-label={`重试刷新 ${source.displayName ?? source.id}`}
    aria-busy={pending}
    disabled={pending}
    onClick={() => void refresh.request({ reason: "manual-source", sourceId: source.id })}
    type="button" variant="text" size="compact"
  >{pending ? "重试中…" : action.label}</VibeButton>;
}

export function AssetRefreshIssues({ hideSourceNames = false }: { hideSourceNames?: boolean }) {
  const refresh = useAssetRefresh();
  const failed = refresh.failedSources;
  if (failed.length === 0) return null;
  const retryable = failed.filter(source => sourceRecoveryAction(source).href === undefined);
  const pending = failed.some(source => refresh.sourceStatus(source.id).state === "refreshing");
  return <div className="asset-refresh-issues">
    <p role="status">{failed.length} 个来源未更新，继续显示最近成功数据。</p>
    {hideSourceNames ? null : <ul aria-label="未更新的资产来源">
      {failed.map(source => <li key={source.id}>
        <div>
          <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}?view=manage`}>
            {source.displayName ?? source.id}
          </VibeEntityLink>
          <p>{source.sync?.error != null ? sourceSyncStatus({ ...source, sync: source.sync })?.label
            : "刷新请求未完成，原因尚未确认。保留已有资产数据。"}</p>
        </div>
        <AssetSourceRecoveryAction source={source} />
      </li>)}
    </ul>}
    {retryable.length > 1 ? <VibeButton
      aria-busy={pending} disabled={pending} type="button" variant="outline" size="compact"
      onClick={() => void Promise.all(retryable.map(source => refresh.request({ reason: "manual-source", sourceId: source.id })))}
    >{pending ? "重试中…" : "重试失败来源"}</VibeButton> : null}
  </div>;
}
