"use client";

import type { ReactNode } from "react";

import { WorkbenchHeaderUtilitiesSlot } from "@/ui/workbench-shell";

export function WorkbenchPageHeader({
  actions,
  actionsLabel,
  description,
  eyebrow,
  title,
  titleId,
}: {
  actions?: ReactNode;
  actionsLabel?: string;
  description?: string;
  eyebrow: string;
  title: string;
  titleId?: string;
}) {
  return (
    <header className="workbench-page-header" data-testid="workbench-page-header">
      <div className="workbench-page-header__copy">
        <p className="card-label">{eyebrow}</p>
        <h1 id={titleId}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <div
          aria-label={actionsLabel}
          className="workbench-page-header__actions"
        >
          {actions}
        </div>
      ) : null}
      <WorkbenchHeaderUtilitiesSlot />
    </header>
  );
}
