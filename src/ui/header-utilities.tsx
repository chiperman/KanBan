"use client";

import { useState } from "react";

import { CommandMenu } from "@/ui/command-menu";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDotIcon } from "@/ui/vibe/vibe-dot-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";

export function HeaderUtilities({
  refreshEnabled,
}: {
  refreshEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="header-utilities">
      <button
        type="button"
        className="mobile-settings-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        本机设置
      </button>
      <div className="header-utility-actions" data-open={open ? "true" : "false"}>
        <CommandMenu refreshEnabled={refreshEnabled} />
        <VibeTooltip label="设置">
          <VibeLink
            aria-label="本机设置"
            className="header-action-button header-settings-link"
            href="/settings"
            variant="outline"
          >
            <VibeDotIcon name="gear" size={24} />
          </VibeLink>
        </VibeTooltip>
        <button
          type="button"
          className="header-settings-close"
          onClick={() => setOpen(false)}
        >
          收起设置
        </button>
      </div>
    </div>
  );
}
