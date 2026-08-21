"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CommandMenu } from "@/ui/command-menu";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";

const PRIMARY_DESTINATIONS = [
  { href: "/", label: "总览", icon: "overview" },
  { href: "/assets", label: "资产与持仓", icon: "holdings" },
  { href: "/performance", label: "收益分析", icon: "performance" },
  { href: "/asset-sources", label: "资产来源", icon: "sources" },
  { href: "/settings", label: "设置与安全", icon: "security" },
] as const;

type WorkbenchNavigationIconName = (typeof PRIMARY_DESTINATIONS)[number]["icon"];

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
  iconOnly = false,
  showIcon = iconOnly,
}: {
  iconOnly?: boolean;
  showIcon?: boolean;
}) {
  const pathname = usePathname();

  return (
    <>
      {PRIMARY_DESTINATIONS.map(({ href, icon, label }) => (
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
      {commandMenu ? (
        <div className="workbench-command">
          <CommandMenu refreshEnabled={refreshEnabled} />
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchUtilitiesMount({
  commandMenu,
  refreshEnabled,
}: {
  commandMenu: boolean;
  refreshEnabled: boolean;
}) {
  const pathname = usePathname();
  const [utilitySlot, setUtilitySlot] = useState<HTMLElement | null>(null);
  const [useHeaderUtilities, setUseHeaderUtilities] = useState(false);

  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1199px)");
    const updatePlacement = () => setUseHeaderUtilities(mediaQuery.matches);
    updatePlacement();
    mediaQuery.addEventListener("change", updatePlacement);
    return () => mediaQuery.removeEventListener("change", updatePlacement);
  }, []);

  useLayoutEffect(() => {
    if (!useHeaderUtilities) {
      setUtilitySlot(null);
      return;
    }

    setUtilitySlot(
      document.querySelector<HTMLElement>("[data-workbench-utilities-slot]"),
    );
  }, [pathname, useHeaderUtilities]);

  const utilities = (
    <WorkbenchUtilities
      commandMenu={commandMenu}
      refreshEnabled={refreshEnabled}
    />
  );

  return useHeaderUtilities && utilitySlot !== null
    ? createPortal(utilities, utilitySlot)
    : utilities;
}

export function WorkbenchShell({
  children,
  commandMenu = true,
  refreshEnabled,
}: {
  children: ReactNode;
  commandMenu?: boolean;
  refreshEnabled: boolean;
}) {
  return (
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
          <WorkbenchDestinationLinks showIcon />
        </div>
      </nav>
      <div className="workbench-shell-content">{children}</div>
      <WorkbenchUtilitiesMount
        commandMenu={commandMenu}
        refreshEnabled={refreshEnabled}
      />
      <nav
        aria-label="工作台主导航"
        className="workbench-navigation workbench-mobile-navigation"
        data-testid="workbench-mobile-navigation"
      >
        <WorkbenchDestinationLinks iconOnly />
      </nav>
    </div>
  );
}
