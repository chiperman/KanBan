"use client";

import {
  cloneElement,
  useId,
  type ReactElement,
} from "react";

interface TooltipTriggerProps {
  "aria-describedby"?: string;
}

export function VibeTooltip({
  align = "center",
  children,
  label,
}: {
  align?: "center" | "end";
  children: ReactElement<TooltipTriggerProps>;
  label: string;
}) {
  const tooltipId = useId();
  const describedBy = [
    children.props["aria-describedby"],
    tooltipId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="vibe-tooltip" data-align={align}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span className="vibe-tooltip__content" id={tooltipId} role="tooltip">
        {label}
      </span>
    </span>
  );
}
