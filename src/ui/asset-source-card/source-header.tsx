"use client";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { assetSourceKindMetadata } from "@/domain/asset-source-kinds";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import type { AssetSourceView } from "./types";

function providerCardLabel(source: AssetSourceView): string {
  return assetSourceKindMetadata(source.kind)?.title ?? "资产来源";
}

function providerCode(source: AssetSourceView): string {
  return assetSourceKindMetadata(source.kind)?.code ?? "SRC";
}

function sourceHeading(source: AssetSourceView): {
  title: string;
  metadata: string | null;
} {
  return { title: assetSourceDisplayName(source), metadata: null };
}

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
  const heading = sourceHeading(source);
  const sourceState = isManual
    ? { label: null, tone: "muted" as const }
    : source.lifecycle === "disconnected"
    ? { label: "OFFLINE", tone: "muted" as const }
    : source.sync.error
      ? { label: "ERROR", tone: "error" as const }
      : source.sync.status === "expired"
        ? { label: "STALE", tone: "warning" as const }
        : { label: "CURRENT", tone: "success" as const };
  return (
    <>
      <header className="asset-source-head">
        <p className="card-label">{providerCardLabel(source)}</p>
        <div className="asset-source-head-actions">
          <VibeStatusTag
            className={`source-live-state ${source.sync.status}`}
            tone={sourceState.tone}
          >
            {sourceState.label
              ? `${providerCode(source)} / ${sourceState.label}`
              : providerCode(source)}
          </VibeStatusTag>
          {showRefreshControl && !isManual && source.lifecycle !== "disconnected" ? (
            <AssetSourceRefreshButton
              disabled={refreshDisabled}
              onDisabledClick={onReadOnlyAction}
              sourceId={source.id}
              sourceName={heading.title}
            />
          ) : null}
        </div>
      </header>
      <h2 className="asset-source-title">{heading.title}</h2>
      {heading.metadata ? (
        <p className="asset-source-meta">{heading.metadata}</p>
      ) : null}
    </>
  );
}
