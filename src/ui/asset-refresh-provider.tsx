"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AssetRefreshIntent, AssetRefreshReport } from "@/server/ports";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import {
  AssetRefreshCoordinator,
  type AssetRefreshRegistration as CoordinatorRegistration,
  type AssetRefreshStatus,
  type RefreshableAssetSource,
} from "@/ui/asset-refresh-coordinator";

export interface AssetRefreshRegistration {
  attemptedAt: string | null;
  inProgressAt?: string | null;
  sources: RefreshableAssetSource[];
}

interface AssetRefreshValue {
  canRefresh: boolean;
  globalStatus: AssetRefreshStatus;
  clear(): void;
  register(registration: AssetRefreshRegistration): void;
  request(intent: AssetRefreshIntent): Promise<void>;
  sourceStatus(sourceId: string): AssetRefreshStatus;
}

const AssetRefreshContext = createContext<AssetRefreshValue | null>(null);

function currentBrowserState(): Pick<
  CoordinatorRegistration,
  "visible" | "focused"
> {
  return {
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
  };
}

async function requestAssetRefresh(
  intent: AssetRefreshIntent,
): Promise<AssetRefreshReport> {
  const response = await fetch("/api/asset-sources/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "all", intent }),
  });
  const result = (await response.json().catch(() => null)) as
    | (AssetRefreshReport & { error?: string })
    | null;
  if (response.status === 401) {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
    throw new Error("所有者会话已失效");
  }
  if (!response.ok || result === null) {
    throw new Error(result?.error ?? "资产刷新失败");
  }
  return result;
}

async function readAssetRefreshState() {
  const response = await fetch("/api/asset-sources/refresh", { cache: "no-store" });
  if (response.status === 401) {
    window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
    throw new Error("所有者会话已失效");
  }
  if (!response.ok) throw new Error("读取资产刷新状态失败");
  return await response.json() as { attemptedAt: string | null; inProgressAt: string | null };
}

export function AssetRefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const registeredRef = useRef(false);
  const [revision, render] = useState(0);
  const coordinatorRef = useRef<AssetRefreshCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = new AssetRefreshCoordinator({
      now: () => new Date(),
      request: requestAssetRefresh,
      readState: readAssetRefreshState,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle as number),
      onReport: () => routerRef.current.refresh(),
      onRecovered: () => routerRef.current.refresh(),
    });
  }
  const coordinator = coordinatorRef.current;
  const clear = useCallback(() => {
    registeredRef.current = false;
    coordinator.clear();
  }, [coordinator]);

  useEffect(() => coordinator.subscribe(() => render((value) => value + 1)), [coordinator]);

  useEffect(() => {
    const update = () => coordinator.setBrowserState(currentBrowserState());
    const foreground = () => {
      void coordinator.reconsiderForeground(currentBrowserState());
    };
    update();
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("blur", update);
    window.addEventListener(OWNER_LOCK_EVENT, clear);
    return () => {
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("blur", update);
      window.removeEventListener(OWNER_LOCK_EVENT, clear);
      coordinator.clear();
    };
  }, [clear, coordinator]);

  useEffect(() => {
    if (coordinator.feedback !== "manual" ||
        coordinator.state === "idle" || coordinator.state === "refreshing" ||
        coordinator.state === "planning") return;
    const timer = window.setTimeout(() => coordinator.dismissFeedback(), 2_400);
    return () => window.clearTimeout(timer);
  }, [coordinator, coordinator.feedback, coordinator.state]);

  const register = useCallback((registration: AssetRefreshRegistration) => {
    const pageEntry = !registeredRef.current;
    registeredRef.current = true;
    void coordinator.register({
      ...registration,
      ...currentBrowserState(),
      pageEntry,
    });
  }, [coordinator]);
  const request = useCallback(
    (intent: AssetRefreshIntent) => coordinator.request(intent),
    [coordinator],
  );
  const sourceStatus = useCallback(
    (sourceId: string) => coordinator.sourceStatus(sourceId),
    [coordinator],
  );

  const value = useMemo<AssetRefreshValue>(() => ({
    canRefresh: coordinator.canRefresh,
    clear,
    globalStatus: coordinator.globalStatus(),
    register,
    request,
    sourceStatus,
  }), [
    clear,
    coordinator,
    register,
    request,
    revision,
    sourceStatus,
  ]);

  return (
    <AssetRefreshContext.Provider value={value}>
      {children}
    </AssetRefreshContext.Provider>
  );
}

export function useAssetRefresh(): AssetRefreshValue {
  const value = useContext(AssetRefreshContext);
  if (value === null) throw new Error("AssetRefreshProvider 尚未挂载");
  return value;
}

export function AssetRefreshReset() {
  const { clear } = useAssetRefresh();
  useEffect(() => clear(), [clear]);
  return null;
}
