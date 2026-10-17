"use client";

import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useState,
} from "react";

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

const PRIMARY_DESTINATIONS = [
  { href: "/", label: "总览", shortLabel: "总览", icon: "overview" },
  { href: "/assets", label: "资产与持仓", shortLabel: "持仓", icon: "holdings" },
  { href: "/performance", label: "收益分析", shortLabel: "收益", icon: "performance" },
  { href: "/asset-sources", label: "来源管理", shortLabel: "来源", icon: "sources" },
  { href: "/settings", label: "设置与安全", shortLabel: "设置", icon: "security" },
] as const;

type WorkbenchDestination = (typeof PRIMARY_DESTINATIONS)[number];
type WorkbenchNavigationIconName = (typeof PRIMARY_DESTINATIONS)[number]["icon"];

const DESKTOP_NAVIGATION_GROUPS = [
  {
    id: "portfolio",
    label: "资产组合",
    destinations: [PRIMARY_DESTINATIONS[1], PRIMARY_DESTINATIONS[2]],
  },
  {
    id: "management",
    label: "管理",
    destinations: [PRIMARY_DESTINATIONS[3], PRIMARY_DESTINATIONS[4]],
  },
] as const;

type WorkbenchNavigationGroupId =
  (typeof DESKTOP_NAVIGATION_GROUPS)[number]["id"];

function isCurrentDestination(pathname: string, href: string) {
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
    sources: (
      <>
        <ellipse cx="12" cy="5.5" rx="7.25" ry="2.75" />
        <path d="M4.75 5.5v6c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75v-6" />
        <path d="M4.75 11.5v6c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75v-6" />
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
}: {
  destinations?: readonly WorkbenchDestination[];
  mobile?: boolean;
  compact?: boolean;
}) {
  const pathname = usePathname();

  return (
    <>
      {destinations.map(({ href, icon, label, shortLabel }) => {
        const link = <VibeLink
          aria-label={label}
          aria-current={
            isCurrentDestination(pathname, href) ? "page" : undefined
          }
          className="workbench-navigation-link"
          href={href}
          key={href}
          variant="text"
        >
          <WorkbenchNavigationIcon name={icon} />
          <span className="workbench-navigation-link__label">{mobile ? shortLabel : label}</span>
        </VibeLink>;
        return compact ? <VibeTooltip key={href} label={label} side="right">{link}</VibeTooltip> : link;
      })}
    </>
  );
}

function WorkbenchNavigationGroupChevron() {
  return (
    <svg
      aria-hidden="true"
      className="workbench-navigation-group-chevron"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

function WorkbenchDesktopNavigationGroups({ compact }: { compact: boolean }) {
  const pathname = usePathname();
  const [expandedGroups, setExpandedGroups] = useState<
    Record<WorkbenchNavigationGroupId, boolean>
  >({
    portfolio: true,
    management: true,
  });

  return (
    <div className="workbench-navigation-groups">
      {DESKTOP_NAVIGATION_GROUPS.map(({ id, label, destinations }) => {
        const includesCurrentDestination = destinations.some(({ href }) =>
          isCurrentDestination(pathname, href),
        );
        const isExpanded =
          includesCurrentDestination || expandedGroups[id];
        const destinationListId = `workbench-navigation-group-${id}`;
        const actionLabel = isExpanded ? "收起" : "展开";

        return (
          <section className="workbench-navigation-group" key={id}>
            <VibeButton
              aria-controls={destinationListId}
              aria-disabled={includesCurrentDestination || undefined}
              aria-expanded={isExpanded}
              aria-label={
                includesCurrentDestination
                  ? `${label}导航已展开（当前页面）`
                  : `${actionLabel}${label}导航`
              }
              className="workbench-navigation-group-trigger"
              onClick={() => {
                if (!includesCurrentDestination) {
                  setExpandedGroups((groups) => ({
                    ...groups,
                    [id]: !groups[id],
                  }));
                }
              }}
              type="button"
              variant="text"
            >
              <span>{label}</span>
              <WorkbenchNavigationGroupChevron />
            </VibeButton>
            <div
              className="workbench-navigation-group-destinations"
              hidden={!isExpanded && !compact}
              id={destinationListId}
            >
              <WorkbenchDestinationLinks destinations={destinations} compact={compact} />
            </div>
          </section>
        );
      })}
    </div>
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
        <span className="workbench-utility-group__label">视图工具</span>
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
        <span className="workbench-utility-group__label">账户工具</span>
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
            <span aria-hidden="true" className="workbench-navigation-brand-index">
              01
            </span>
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
              destinations={[PRIMARY_DESTINATIONS[0]]}
              compact={sidebarCollapsed}
            />
            <WorkbenchDesktopNavigationGroups compact={sidebarCollapsed} />
          </div>
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
        <WorkbenchDestinationLinks mobile />
      </nav>
    </div>
  );
}
