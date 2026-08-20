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
  { href: "/", label: "总览" },
  { href: "/assets", label: "资产与持仓" },
  { href: "/performance", label: "收益分析" },
  { href: "/asset-sources", label: "资产来源" },
  { href: "/settings", label: "设置与安全" },
] as const;

function isCurrentDestination(pathname: string, href: string) {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function WorkbenchDestinationLinks() {
  const pathname = usePathname();

  return (
    <>
      {PRIMARY_DESTINATIONS.map(({ href, label }) => (
        <VibeLink
          aria-current={
            isCurrentDestination(pathname, href) ? "page" : undefined
          }
          className="workbench-navigation-link"
          href={href}
          key={href}
          variant="text"
        >
          {label}
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
          <WorkbenchDestinationLinks />
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
        <WorkbenchDestinationLinks />
      </nav>
    </div>
  );
}
