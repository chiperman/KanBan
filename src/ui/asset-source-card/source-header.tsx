"use client";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { sourceSyncStatus, sourceSummaryStatus } from "@/ui/asset-source-status";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import type { AssetSourceView } from "./types";

export function AssetSourceHeader({
  source,
  refreshDisabled,
  showRefreshControl,
  onReadOnlyAction,
}: {
  source: AssetSourceView;
  refreshDisabled: boolean;
  showRefreshControl: boolean;
  onReadOnlyAction?: () => void;
}) {
  const isManual = source.kind === "manual";
  const longbridge = source.kind === "longbridge";
  if (isManual) return null;
  const sourceState = sourceSummaryStatus(source);
  return (
    <header className="asset-source-head">
      <div className="asset-source-head-actions">
        <VibeStatusTag
          className={`source-live-state ${source.sync.status}`}
          tone={sourceState.tone}
          title={longbridge ? sourceSyncStatus(source)?.label : undefined}
        >
          {sourceState.label}
        </VibeStatusTag>
        {showRefreshControl && source.lifecycle !== "disconnected" ? (
          <AssetSourceRefreshButton
            disabled={refreshDisabled}
            onDisabledClick={onReadOnlyAction}
            sourceId={source.id}
            sourceName={assetSourceDisplayName(source)}
          />
        ) : null}
      </div>
    </header>
  );
}
