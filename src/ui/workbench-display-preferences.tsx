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
};

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

export function WorkbenchDisplayPreferencesProvider({
  children,
  persist = true,
}: {
  children: ReactNode;
  persist?: boolean;
}) {
  const persistenceEnabled = persist && !isDemoModeLocation();
  const [currency, setCurrentCurrency] = useState<ReportingCurrency>("USD");
  // SSR 与首次 hydration 都先隐藏真实金额，避免读取会话偏好前短暂泄露。
  // 演示模式的独立 provider 不持久化，仅展示虚构数据。
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(!persist);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!persistenceEnabled) {
      setCurrentCurrency("USD");
      setShowSensitiveInfo(true);
      setSidebarCollapsed(false);
      document.documentElement.dataset.sidebarCollapsed = "false";
      return;
    }
    setCurrentCurrency(storedCurrency());
    setShowSensitiveInfo(!sensitiveInfoIsHidden());
    try {
      const collapsed = window.localStorage.getItem("pad-sidebar-collapsed") === "true";
      setSidebarCollapsed(collapsed);
      document.documentElement.dataset.sidebarCollapsed = String(collapsed);
    } catch {
      // 存储不可用时保留可操作的展开导航。
    }
  }, [persistenceEnabled]);

  useEffect(() => {
    if (!persistenceEnabled) return;

    function resetSensitiveInfo() {
      setShowSensitiveInfo(true);
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

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      showSensitiveInfo,
      toggleSensitiveInfo,
      sidebarCollapsed,
      toggleSidebar,
    }),
    [currency, setCurrency, showSensitiveInfo, toggleSensitiveInfo, sidebarCollapsed, toggleSidebar],
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
