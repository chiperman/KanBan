"use client";

import type { ReactNode } from "react";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";

export function WorkbenchPageHeader({
  actions,
  actionsLabel,
  backLink,
  description,
  eyebrow,
  title,
  titleId,
}: {
  actions?: ReactNode;
  actionsLabel?: string;
  backLink?: { href: string; label: string };
  description?: ReactNode;
  eyebrow: string;
  title: string;
  titleId?: string;
}) {
  return (
    <header className="workbench-page-header" data-testid="workbench-page-header">
      <div className="workbench-page-header__copy">
        {backLink ? (
          <div className="workbench-page-header__heading">
            <VibeTooltip label={backLink.label} side="right">
              <VibeLink
                aria-label={backLink.label}
                className="workbench-page-header__back"
                href={backLink.href}
                variant="outline"
              >
                <VibeIcon name="arrow-left" />
              </VibeLink>
            </VibeTooltip>
            <div className="workbench-page-header__title-copy">
              <p className="card-label">{eyebrow}</p>
              <h1 id={titleId}>{title}</h1>
            </div>
          </div>
        ) : (
          <>
            <p className="card-label">{eyebrow}</p>
            <h1 id={titleId}>{title}</h1>
          </>
        )}
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <div className="workbench-page-header__control-rail">
          <div
            aria-label={actionsLabel}
            className="workbench-page-header__actions"
            data-label="页面操作"
          >
            {actions}
          </div>
        </div>
      ) : null}
    </header>
  );
}
