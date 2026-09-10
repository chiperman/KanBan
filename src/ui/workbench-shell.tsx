"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
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
import {
  type AssetRefreshRegistration,
  useAssetRefresh,
} from "@/ui/asset-refresh-provider";

const PRIMARY_DESTINATIONS = [
  { href: "/", label: "总览", icon: "overview" },
  { href: "/assets", label: "资产与持仓", icon: "holdings" },
  { href: "/performance", label: "收益分析", icon: "performance" },
  { href: "/asset-sources", label: "资产来源", icon: "sources" },
  { href: "/settings", label: "设置与安全", icon: "security" },
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

const WorkbenchHeaderUtilitiesContext = createContext<ReactNode>(null);

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
  iconOnly = false,
  showIcon = iconOnly,
}: {
  destinations?: readonly WorkbenchDestination[];
  iconOnly?: boolean;
  showIcon?: boolean;
}) {
  const pathname = usePathname();

  return (
    <>
      {destinations.map(({ href, icon, label }) => (
        <VibeLink
          aria-label={iconOnly ? label : undefined}
          aria-current={
            isCurrentDestination(pathname, href) ? "page" : undefined
          }
          className="workbench-navigation-link"
          href={href}
          key={href}
          variant="text"
        >
          {showIcon ? <WorkbenchNavigationIcon name={icon} /> : null}
          {iconOnly ? null : <span>{label}</span>}
        </VibeLink>
      ))}
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

function WorkbenchDesktopNavigationGroups() {
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
              hidden={!isExpanded}
              id={destinationListId}
            >
              <WorkbenchDestinationLinks destinations={destinations} showIcon />
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
      aria-pressed={!showSensitiveInfo}
      className="workbench-privacy-toggle"
      data-testid="global-sensitive-info-toggle"
      onClick={toggleSensitiveInfo}
      type="button"
      variant="outline"
    >
      {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
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
      <WorkbenchPrivacyToggle />
      <div className="workbench-utility-actions">
        <ThemeSwitcher />
        <LogoutButton />
      </div>
      {commandMenu ? (
        <div className="workbench-command">
          <CommandMenu refreshEnabled={refreshEnabled} />
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchHeaderUtilitiesSlot() {
  const utilities = useContext(WorkbenchHeaderUtilitiesContext);

  return (
    <div
      className="workbench-page-header__utilities"
      data-workbench-utilities-slot
    >
      {utilities}
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
  useEffect(() => {
    if (refreshRegistration !== undefined) register(refreshRegistration);
  }, [refreshRegistration, register]);

  return (
    <WorkbenchHeaderUtilitiesContext.Provider
      value={
        <WorkbenchUtilities
          commandMenu={commandMenu}
          refreshEnabled={refreshEnabled}
        />
      }
    >
      <div className="workbench-shell" data-testid="workbench-shell">
        <nav
          aria-label="工作台主导航"
          className="workbench-navigation workbench-desktop-navigation"
          data-testid="workbench-desktop-navigation"
        >
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
              <strong lang="en">PERSONAL ASSET</strong>
              <span lang="en">DASHBOARD</span>
            </span>
          </VibeLink>
          <div className="workbench-navigation-links">
            <WorkbenchDestinationLinks
              destinations={[PRIMARY_DESTINATIONS[0]]}
              showIcon
            />
            <WorkbenchDesktopNavigationGroups />
          </div>
        </nav>
        <div className="workbench-shell-content">{children}</div>
        <nav
          aria-label="工作台主导航"
          className="workbench-navigation workbench-mobile-navigation"
          data-testid="workbench-mobile-navigation"
        >
          <WorkbenchDestinationLinks iconOnly />
        </nav>
      </div>
    </WorkbenchHeaderUtilitiesContext.Provider>
  );
}
