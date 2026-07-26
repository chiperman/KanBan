"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AssetRefreshMode, AssetRefreshReport } from "@/server/ports";

export function AssetRefreshControls({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const lastPriceRefresh = useRef(Date.now());
  const lastHoldingsRefresh = useRef(Date.now());
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("等待同步");

  const refresh = useCallback(async (
    mode: AssetRefreshMode,
    manual: boolean,
  ): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setStatus(
      manual || mode !== "prices"
        ? "正在刷新余额与持仓…"
        : "正在刷新行情…",
    );
    try {
      const response = await fetch("/api/asset-sources/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (response.status === 401) {
        window.location.reload();
        return false;
      }
      const result = (await response.json().catch(() => null)) as
        | (AssetRefreshReport & { error?: string })
        | null;
      if (!response.ok || !result) {
        throw new Error(result?.error ?? "资产同步失败");
      }
      setStatus(
        result.failureCount > 0
          ? `同步完成 · ${result.failureCount} 个来源失败`
          : "同步完成",
      );
      router.refresh();
      return true;
    } catch (error) {
      setStatus(
        `同步失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      );
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [router]);

  const runAndMark = useCallback(async (
    mode: AssetRefreshMode,
    manual = false,
  ) => {
    if (!(await refresh(mode, manual))) return;
    const now = Date.now();
    if (mode === "all" || mode === "holdings") {
      lastHoldingsRefresh.current = now;
    }
    if (mode === "all" || mode === "holdings" || mode === "prices") {
      lastPriceRefresh.current = now;
    }
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    void runAndMark("all");
    const tick = () => {
      if (document.visibilityState === "hidden" || inFlight.current) return;
      const now = Date.now();
      if (now - lastHoldingsRefresh.current >= 5 * 60_000) {
        void runAndMark("holdings");
      } else if (now - lastPriceRefresh.current >= 30_000) {
        void runAndMark("prices");
      }
    };
    const timer = window.setInterval(tick, 30_000);
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, runAndMark]);

  if (!enabled) return null;
  return (
    <div className="asset-refresh-controls">
      <button
        type="button"
        disabled={pending}
        onClick={() => void runAndMark("all", true)}
      >
        立即刷新资产
      </button>
      <p data-testid="asset-refresh-status" role="status">{status}</p>
    </div>
  );
}
