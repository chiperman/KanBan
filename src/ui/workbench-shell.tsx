"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { CommandMenu } from "@/ui/command-menu";
import { VibeLink } from "@/ui/vibe/vibe-button";

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
      {commandMenu ? (
        <div className="workbench-command">
          <CommandMenu refreshEnabled={refreshEnabled} />
        </div>
      ) : null}
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
