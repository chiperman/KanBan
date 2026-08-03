"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshScope,
} from "@/server/ports";
import { ASSET_MANUAL_REFRESH_EVENT } from "@/shared/command-events";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

async function requestAssetRefresh(input: {
  mode: AssetRefreshMode;
  scope?: AssetRefreshScope;
  sourceId?: string;
}): Promise<AssetRefreshReport> {
  const response = await fetch("/api/asset-sources/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 401) {
    window.location.reload();
    throw new Error("所有者会话已失效");
  }
  const result = (await response.json().catch(() => null)) as
    | (AssetRefreshReport & { error?: string })
    | null;
  if (!response.ok || !result) {
    throw new Error(result?.error ?? "资产同步失败");
  }
  return result;
}

export function AssetSourceRefreshButton({
  disabled = false,
  sourceId,
  sourceName,
}: {
  disabled?: boolean;
  sourceId: string;
  sourceName: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const completionReset = useRef<number | null>(null);

  useEffect(() => () => {
    if (completionReset.current !== null) {
      window.clearTimeout(completionReset.current);
    }
  }, []);

  const refreshSource = useCallback(async () => {
    if (inFlight.current || disabled) return;
    if (completionReset.current !== null) {
      window.clearTimeout(completionReset.current);
      completionReset.current = null;
    }
    inFlight.current = true;
    setState("pending");
    setMessage("正在刷新");
    try {
      const result = await requestAssetRefresh({
        mode: "all",
        sourceId,
      });
      if (result.failureCount > 0) {
        throw new Error("来源同步失败，已保留最后成功数据");
      }
      setState("success");
      setMessage("刷新完成");
      router.refresh();
      completionReset.current = window.setTimeout(() => {
        setState("idle");
        setMessage("");
        completionReset.current = null;
      }, 2_400);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "刷新失败，请稍后重试",
      );
    } finally {
      inFlight.current = false;
    }
  }, [disabled, router, sourceId]);

  const buttonLabel =
    state === "pending"
      ? "刷新中"
      : state === "success"
        ? "已刷新"
        : state === "error"
          ? "重试"
          : "刷新";

  return (
    <div
      className="asset-source-refresh-control"
      data-refresh-state={state}
    >
      <VibeButton
        type="button"
        className="asset-source-refresh-button"
        aria-label={`刷新 ${sourceName}`}
        aria-busy={state === "pending" || disabled}
        disabled={state === "pending" || disabled}
        onClick={() => void refreshSource()}
        variant="text"
      >
        <svg
          aria-hidden="true"
          className="asset-source-refresh-icon"
          viewBox="0 0 24 24"
        >
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
        </svg>
        <span>{buttonLabel}</span>
      </VibeButton>
      {state !== "idle" ? (
        <span
          className="asset-source-refresh-feedback"
          data-refresh-state={state}
          data-testid={`asset-source-refresh-status-${sourceId}`}
          role="status"
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}

export function AssetRefreshControls({
  enabled,
  hasEvmSources,
  hasNonEvmSources,
  needsDailyEvmPriceRefresh,
  onPendingChange,
}: {
  enabled: boolean;
  hasEvmSources: boolean;
  hasNonEvmSources: boolean;
  needsDailyEvmPriceRefresh: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const automaticRefreshAttempted = useRef(false);
  const initialAutomaticPlan = useRef({
    hasEvmSources,
    hasNonEvmSources,
    needsDailyEvmPriceRefresh,
  });
  const lastPriceRefresh = useRef(Date.now());
  const lastHoldingsRefresh = useRef(Date.now());
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("等待同步");
  const [showStatus, setShowStatus] = useState(false);

  const refresh = useCallback(async (
    mode: AssetRefreshMode,
    manual: boolean,
    scope: AssetRefreshScope = "all",
  ): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    onPendingChange?.(true);
    setPending(true);
    setShowStatus(true);
    setStatus(
      manual || mode !== "prices"
        ? "正在刷新余额与持仓…"
        : "正在刷新行情…",
    );
    try {
      const result = await requestAssetRefresh({ mode, scope });
      const hasFailures = result.failureCount > 0;
      setShowStatus(true);
      setStatus(hasFailures ? `同步完成 · ${result.failureCount} 个来源失败` : "同步完成");
      router.refresh();
      return true;
    } catch (error) {
      setShowStatus(true);
      setStatus(
        `同步失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      );
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }, [onPendingChange, router]);

  const runAndMark = useCallback(async (
    mode: AssetRefreshMode,
    manual = false,
    scope: AssetRefreshScope = "all",
  ) => {
    if (!(await refresh(mode, manual, scope))) return;
    if (scope !== "non-evm") return;
    const now = Date.now();
    if (mode === "all" || mode === "holdings") {
      lastHoldingsRefresh.current = now;
    }
    if (mode === "all" || mode === "holdings" || mode === "prices") {
      lastPriceRefresh.current = now;
    }
  }, [refresh]);

  useEffect(() => {
    if (!enabled || automaticRefreshAttempted.current) return;
    automaticRefreshAttempted.current = true;
    const plan = initialAutomaticPlan.current;
    void (async () => {
      if (plan.hasNonEvmSources) {
        await runAndMark("all", false, "non-evm");
      }
      if (plan.hasEvmSources && plan.needsDailyEvmPriceRefresh) {
        await runAndMark("prices", false, "evm");
      }
    })();
  }, [enabled, runAndMark]);

  useEffect(() => {
    if (!hasNonEvmSources) return;
    const tick = () => {
      if (document.visibilityState === "hidden" || inFlight.current) return;
      const now = Date.now();
      if (now - lastHoldingsRefresh.current >= 5 * 60_000) {
        void runAndMark("holdings", false, "non-evm");
      } else if (now - lastPriceRefresh.current >= 30_000) {
        void runAndMark("prices", false, "non-evm");
      }
    };
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [hasNonEvmSources, runAndMark]);

  useEffect(() => {
    if (!enabled) return;
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") {
        void runAndMark("all");
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => document.removeEventListener("visibilitychange", visibilityChanged);
  }, [enabled, runAndMark]);

  useEffect(() => {
    if (!enabled) return;
    const manualRefresh = () => void runAndMark("all", true);
    window.addEventListener(ASSET_MANUAL_REFRESH_EVENT, manualRefresh);
    return () => window.removeEventListener(ASSET_MANUAL_REFRESH_EVENT, manualRefresh);
  }, [enabled, runAndMark]);

  if (!enabled) return null;
  return (
    <div className="asset-refresh-controls">
      <VibeButton
        type="button"
        aria-label="立即刷新资产"
        disabled={pending}
        onClick={() => void runAndMark("all", true)}
        variant="primary"
      >
        {pending ? "正在刷新资产…" : "立即刷新资产"}
      </VibeButton>
      <VibeStatusTag
        className={`asset-refresh-status${showStatus ? " is-visible" : ""}`}
        data-testid="asset-refresh-status"
        role="status"
        tone={pending ? "live" : status.includes("失败") ? "error" : "success"}
      >
        {status}
      </VibeStatusTag>
    </div>
  );
}
