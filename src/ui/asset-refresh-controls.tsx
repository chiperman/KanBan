"use client";

import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

function resultLabel(state: "success" | "partial" | "error"): string {
  if (state === "success") return "刷新完成";
  if (state === "partial") return "部分来源刷新失败";
  return "刷新失败";
}

function AssetRefreshIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`asset-refresh-icon ${className}`}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
    </svg>
  );
}

export function AssetGlobalRefreshControl() {
  const refresh = useAssetRefresh();
  if (!refresh.canRefresh) return null;

  const global = refresh.globalStatus;
  const pending = global.state === "refreshing";
  const terminal = global.state === "success" ||
    global.state === "partial" || global.state === "error";
  const showStatus = global.feedback === "manual" && terminal;
  const terminalState = terminal
    ? global.state as "success" | "partial" | "error"
    : null;
  const status = terminalState !== null
    ? resultLabel(terminalState)
    : "";

  return (
    <div
      className="asset-refresh-controls"
      data-refresh-state={pending ? "pending" : global.state}
    >
      <VibeButton
        aria-busy={pending}
        aria-label="立即刷新资产"
        disabled={pending}
        onClick={() => void refresh.request({ reason: "manual-global" })}
        type="button"
        variant="outline"
      >
        <AssetRefreshIcon className="asset-global-refresh-icon" />
        <span>{pending ? "刷新中…" : "立即刷新资产"}</span>
      </VibeButton>
      {showStatus ? (
        <VibeStatusTag
          className="asset-refresh-status is-visible"
          data-testid="asset-refresh-status"
          role="status"
          title={global.state === "error" ? global.message : undefined}
          tone={global.state === "success" ? "success" : "error"}
        >
          {status}
        </VibeStatusTag>
      ) : null}
    </div>
  );
}

export function AssetSourceRefreshButton({
  disabled = false,
  onDisabledClick,
  sourceId,
  sourceName,
}: {
  disabled?: boolean;
  onDisabledClick?: () => void;
  sourceId: string;
  sourceName: string;
}) {
  const refresh = useAssetRefresh();
  const global = refresh.globalStatus;
  const source = refresh.sourceStatus(sourceId);
  const coveredByGlobal = global.state === "refreshing";
  const sourceHasActivity = source.state !== "idle";
  const current = coveredByGlobal
    ? global
    : sourceHasActivity
      ? source
      : global.feedback === "manual" && global.state !== "idle"
        ? global
        : source;
  const pending = current.state === "refreshing";
  const terminal = current.feedback === "manual" &&
    (current.state === "success" || current.state === "partial" ||
      current.state === "error");
  const state = pending ? "pending" : terminal ? current.state : "idle";

  return (
    <div className="asset-source-refresh-control" data-refresh-state={state}>
      <VibeButton
        aria-busy={pending}
        aria-label={`刷新 ${sourceName}`}
        className="asset-source-refresh-button"
        data-demo-disabled={disabled && onDisabledClick ? "true" : undefined}
        disabled={pending || (disabled && !onDisabledClick)}
        onClick={() => {
          if (disabled) {
            onDisabledClick?.();
            return;
          }
          void refresh.request({ reason: "manual-source", sourceId });
        }}
        type="button"
        variant="outline"
      >
        <AssetRefreshIcon className="asset-source-refresh-icon" />
        <span>{pending ? "刷新中…" : "刷新"}</span>
      </VibeButton>
      {pending || terminal ? (
        <span
          className="asset-source-refresh-feedback"
          data-refresh-state={state}
          data-testid={`asset-source-refresh-status-${sourceId}`}
          role="status"
          title={current.state === "error" ? current.message : undefined}
        >
          {pending
            ? "正在刷新…"
            : resultLabel(current.state as "success" | "partial" | "error")}
        </span>
      ) : null}
    </div>
  );
}
