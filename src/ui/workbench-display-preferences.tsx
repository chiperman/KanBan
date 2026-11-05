"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ReportingCurrency } from "@/domain/valuation";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";

type WorkbenchDisplayPreferences = {
  currency: ReportingCurrency;
  setCurrency(currency: ReportingCurrency): void;
  showSensitiveInfo: boolean;
  toggleSensitiveInfo(): void;
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  showTrendDots: boolean;
  setShowTrendDots(show: boolean): void;
};

type SensitiveInfoPreference = "shown" | "hidden";

const WorkbenchDisplayPreferencesContext =
  createContext<WorkbenchDisplayPreferences | null>(null);

function isDemoModeLocation(): boolean {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mode") === "demo";
}

function storedCurrency(): ReportingCurrency {
  try {
    const value = window.localStorage.getItem("reporting-currency");
    if (value === "USD" || value === "CNY" || value === "HKD") return value;
  } catch {
    // 本地偏好不可用时安全回退为默认计价货币。
  }
  return "USD";
}

function sensitiveInfoIsHidden(): boolean {
  try {
    return window.sessionStorage.getItem("sensitive-info-hidden") === "true";
  } catch {
    return false;
  }
}

function storeSensitiveInfoPreference(showSensitiveInfo: boolean): void {
  try {
    document.cookie =
      `pad-sensitive-info=${showSensitiveInfo ? "shown" : "hidden"}; Path=/; SameSite=Strict`;
  } catch {
    // Cookie 不可用时，当前页面状态和旧会话存储仍然有效。
  }
}

export function WorkbenchDisplayPreferencesProvider({
  children,
  initialSensitiveInfoPreference = null,
  persist = true,
}: {
  children: ReactNode;
  initialSensitiveInfoPreference?: SensitiveInfoPreference | null;
  persist?: boolean;
}) {
  const persistenceEnabled = persist && !isDemoModeLocation();
  const [currency, setCurrentCurrency] = useState<ReportingCurrency>("USD");
  // Cookie 缺失时保持安全隐藏，挂载后再迁移旧的会话偏好。
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(
    !persist || initialSensitiveInfoPreference === "shown",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTrendDots, setCurrentTrendDots] = useState(true);

  useEffect(() => {
    if (!persistenceEnabled) {
      setCurrentCurrency("USD");
      setShowSensitiveInfo(true);
      setSidebarCollapsed(false);
      setCurrentTrendDots(true);
      document.documentElement.dataset.sidebarCollapsed = "false";
      return;
    }
    setCurrentCurrency(storedCurrency());
    if (initialSensitiveInfoPreference === null) {
      const nextShowSensitiveInfo = !sensitiveInfoIsHidden();
      setShowSensitiveInfo(nextShowSensitiveInfo);
      storeSensitiveInfoPreference(nextShowSensitiveInfo);
    }
    try {
      setCurrentTrendDots(window.localStorage.getItem("pad-trend-dots") !== "false");
      const collapsed = window.localStorage.getItem("pad-sidebar-collapsed") === "true";
      setSidebarCollapsed(collapsed);
      document.documentElement.dataset.sidebarCollapsed = String(collapsed);
    } catch {
      // 存储不可用时保留默认显示偏好。
    }
  }, [initialSensitiveInfoPreference, persistenceEnabled]);

  useEffect(() => {
    if (!persistenceEnabled) return;

    function resetSensitiveInfo() {
      setShowSensitiveInfo(true);
      storeSensitiveInfoPreference(true);
      try {
        window.sessionStorage.removeItem("sensitive-info-hidden");
      } catch {
        // 会话存储不可用时，内存状态已恢复为默认显示。
      }
    }

    window.addEventListener(OWNER_LOCK_EVENT, resetSensitiveInfo);
    return () => window.removeEventListener(OWNER_LOCK_EVENT, resetSensitiveInfo);
  }, [persistenceEnabled]);

  const setCurrency = useCallback((nextCurrency: ReportingCurrency) => {
    setCurrentCurrency(nextCurrency);
    if (!persistenceEnabled) return;
    try {
      window.localStorage.setItem("reporting-currency", nextCurrency);
    } catch {
      // 计价货币仍在当前已认证会话内生效。
    }
  }, [persistenceEnabled]);

  const toggleSensitiveInfo = useCallback(() => {
    setShowSensitiveInfo((current) => {
      const next = !current;
      if (!persistenceEnabled) return next;
      try {
        if (next) {
          window.sessionStorage.removeItem("sensitive-info-hidden");
        } else {
          window.sessionStorage.setItem("sensitive-info-hidden", "true");
        }
      } catch {
        // 会话存储不可用时，仍维持当前页面内的显示选择。
      }
      storeSensitiveInfoPreference(next);
      return next;
    });
  }, [persistenceEnabled]);

  const toggleSidebar = useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    document.documentElement.dataset.sidebarCollapsed = String(next);
    if (!persistenceEnabled) return;
    try {
      window.localStorage.setItem("pad-sidebar-collapsed", String(next));
    } catch {
      // 不影响当前页面的侧栏交互。
    }
  }, [persistenceEnabled, sidebarCollapsed]);

  const setShowTrendDots = useCallback((show: boolean) => {
    setCurrentTrendDots(show);
    if (!persistenceEnabled) return;
    try {
      window.localStorage.setItem("pad-trend-dots", String(show));
    } catch {
      // 存储不可用时，仍在当前页面内生效。
    }
  }, [persistenceEnabled]);

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      showSensitiveInfo,
      toggleSensitiveInfo,
      sidebarCollapsed,
      toggleSidebar,
      showTrendDots,
      setShowTrendDots,
    }),
    [currency, setCurrency, showSensitiveInfo, toggleSensitiveInfo, sidebarCollapsed, toggleSidebar, showTrendDots, setShowTrendDots],
  );

  return (
    <WorkbenchDisplayPreferencesContext.Provider value={value}>
      {children}
    </WorkbenchDisplayPreferencesContext.Provider>
  );
}

export function useWorkbenchDisplayPreferences(): WorkbenchDisplayPreferences {
  const value = useContext(WorkbenchDisplayPreferencesContext);
  if (value === null) {
    throw new Error("显示偏好只能在所有者工作台中使用");
  }
  return value;
}
