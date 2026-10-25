"use client";

import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import { WORKBENCH_DESTINATIONS } from "@/ui/workbench-navigation";
import { CommandMenu } from "@/ui/command-menu";
import { LogoutButton } from "@/ui/logout-button";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";
import {
  AssetRefreshAvailabilityProvider,
  type AssetRefreshRegistration,
  useAssetRefresh,
} from "@/ui/asset-refresh-provider";

const PRIMARY_DESTINATIONS = WORKBENCH_DESTINATIONS;
type WorkbenchDestination = (typeof PRIMARY_DESTINATIONS)[number];
type WorkbenchNavigationIconName = WorkbenchDestination["icon"];

function isCurrentDestination(pathname: string, href: string) {
  if (href === "/assets" && pathname.startsWith("/asset-sources")) return true;
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function WorkbenchNavigationIcon({
  name,
}: {
  name: WorkbenchNavigationIconName;
}) {
  const paths = {
    overview: (
      <>
        <rect height="6.5" rx="1" width="6.5" x="3.75" y="3.75" />
        <rect height="6.5" rx="1" width="6.5" x="13.75" y="3.75" />
        <rect height="6.5" rx="1" width="6.5" x="3.75" y="13.75" />
        <rect height="6.5" rx="1" width="6.5" x="13.75" y="13.75" />
      </>
    ),
    holdings: (
      <>
        <path d="M4 7.5h16v11.75H4z" />
        <path d="M4 10h16" />
        <circle cx="16" cy="14.25" r="1" />
      </>
    ),
    performance: (
      <>
        <path d="m4 18.5 5.5-5.5 4 3.5L20 8.5" />
        <path d="M15 8.5h5v5" />
      </>
    ),
    security: <path d="M12 3.5 19 6.5v5.25c0 4.25-2.75 7.75-7 8.75-4.25-1-7-4.5-7-8.75V6.5z" />,
  } satisfies Record<WorkbenchNavigationIconName, ReactNode>;

  return (
    <svg
      aria-hidden="true"
      className="workbench-navigation-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function WorkbenchDestinationLinks({
  destinations = PRIMARY_DESTINATIONS,
  mobile = false,
  compact = false,
  pendingHref,
  onNavigate,
}: {
  destinations?: readonly WorkbenchDestination[];
  mobile?: boolean;
  compact?: boolean;
  pendingHref?: string | null;
  onNavigate?: (href: string, pending: boolean) => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {destinations.map(({ href, icon, label, shortLabel }) => {
        const pending = pendingHref === href && href !== pathname;
        const link = <VibeLink
          aria-busy={pending || undefined}
          aria-label={label}
          aria-current={
            isCurrentDestination(pathname, href) ? "page" : undefined
          }
          className="workbench-navigation-link"
          href={href}
          key={href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            onNavigate?.(href, true);
          }}
          variant="text"
        >
          {pending ? <span className="workbench-navigation-skeleton" /> : <WorkbenchNavigationIcon name={icon} />}
          <span className="workbench-navigation-link__label">{mobile ? shortLabel : label}</span>
        </VibeLink>;
        return compact ? <VibeTooltip key={href} label={label} side="right">{link}</VibeTooltip> : link;
      })}
    </>
  );
}

function WorkbenchPrivacyToggle() {
  const { showSensitiveInfo, toggleSensitiveInfo } =
    useWorkbenchDisplayPreferences();

  return (
    <VibeButton
      aria-label={showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
      aria-pressed={!showSensitiveInfo}
      className="workbench-privacy-toggle"
      data-testid="global-sensitive-info-toggle"
      onClick={toggleSensitiveInfo}
      type="button"
      variant="outline"
    >
      <VibeIcon name={showSensitiveInfo ? "eye" : "eye-off"} />
      <span className="workbench-control-label">{showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}</span>
    </VibeButton>
  );
}

function WorkbenchUtilities({
  commandMenu,
  refreshEnabled,
}: {
  commandMenu: boolean;
  refreshEnabled: boolean;
}) {
  return (
    <div className="workbench-utilities" data-testid="workbench-utilities">
      <div className="workbench-utility-group">
        <div className="workbench-utility-group__controls workbench-utility-primary">
          <VibeTooltip label="隐藏或显示关键信息" side="right">
            <WorkbenchPrivacyToggle />
          </VibeTooltip>
          {commandMenu ? (
            <VibeTooltip label="快捷命令 · ⌘K / Ctrl K" side="right">
              <div className="workbench-command">
                <CommandMenu refreshEnabled={refreshEnabled} />
              </div>
            </VibeTooltip>
          ) : null}
        </div>
      </div>
      <div className="workbench-utility-group">
        <div className="workbench-utility-group__controls workbench-utility-actions">
          <ThemeSwitcher showLabel tooltipSide="right" />
          <LogoutButton showLabel tooltipSide="right" />
        </div>
      </div>
    </div>
  );
}

export function WorkbenchShell({
  children,
  commandMenu = true,
  refreshRegistration,
  refreshEnabled,
}: {
  children: ReactNode;
  commandMenu?: boolean;
  refreshRegistration?: AssetRefreshRegistration;
  refreshEnabled: boolean;
}) {
  const { register } = useAssetRefresh();
  const { sidebarCollapsed, toggleSidebar } = useWorkbenchDisplayPreferences();
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // App Router 无加载反馈；点击侧栏后保持该反馈，直到 pathname 真正变化或超时兜底。
  const setNavigationPending = useCallback((href: string, pending: boolean) => {
    setPendingHref(pending ? href : null);
  }, []);

  useEffect(() => {
    if (pendingHref === null) return;
    if (pathname === pendingHref) {
      setNavigationPending(pendingHref, false);
      return;
    }
    const timer = window.setTimeout(() => setNavigationPending(pendingHref, false), 8000);
    return () => window.clearTimeout(timer);
  }, [pendingHref, pathname, setNavigationPending]);

  useEffect(() => {
    if (refreshRegistration !== undefined) register(refreshRegistration);
  }, [refreshRegistration, register]);

  return (
    <div className="workbench-shell" data-sidebar-collapsed={sidebarCollapsed} data-testid="workbench-shell">
      <aside
        aria-label="工作台导航与工具"
        className="workbench-sidebar"
        data-testid="workbench-sidebar"
        id="workbench-sidebar"
      >
        <div className="workbench-sidebar__head">
          <VibeLink
            aria-label="返回资产总览"
            className="workbench-navigation-brand"
            href="/"
            variant="text"
          >
            <span className="workbench-navigation-brand-copy">
              <strong>资产看板</strong>
              <span lang="en">PERSONAL ASSET</span>
            </span>
          </VibeLink>
          <VibeButton
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="workbench-sidebar"
            className="workbench-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            type="button" variant="text"
          >
            <VibeIcon name={sidebarCollapsed ? "panel-right" : "panel-left"} />
          </VibeButton>
        </div>
        <nav
          aria-label="工作台主导航"
          className="workbench-navigation workbench-desktop-navigation"
          data-testid="workbench-desktop-navigation"
        >
          <div className="workbench-navigation-links">
            <WorkbenchDestinationLinks
              destinations={PRIMARY_DESTINATIONS.slice(0, 3)}
              compact={sidebarCollapsed}
              pendingHref={pendingHref}
              onNavigate={setNavigationPending}
            />
          </div>
        </nav>
        <nav aria-label="设置导航" className="workbench-navigation workbench-desktop-navigation workbench-settings-navigation">
          <WorkbenchDestinationLinks
            destinations={[PRIMARY_DESTINATIONS[3]]}
            compact={sidebarCollapsed}
            pendingHref={pendingHref}
            onNavigate={setNavigationPending}
          />
        </nav>
        <WorkbenchUtilities
          commandMenu={commandMenu}
          refreshEnabled={refreshEnabled}
        />
      </aside>
      <div className="workbench-shell-content">
        <AssetRefreshAvailabilityProvider sources={refreshRegistration?.sources}>
          {children}
        </AssetRefreshAvailabilityProvider>
      </div>
      <nav
        aria-label="工作台主导航"
        className="workbench-navigation workbench-mobile-navigation"
        data-testid="workbench-mobile-navigation"
      >
        <WorkbenchDestinationLinks
          mobile
          pendingHref={pendingHref}
          onNavigate={setNavigationPending}
        />
      </nav>
    </div>
  );
}
