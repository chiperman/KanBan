"use client";

import { useState } from "react";

import { CommandMenu } from "@/ui/command-menu";
import { RecoverySetup } from "@/ui/recovery-setup";

export function HeaderUtilities({
  recoveryConfigured,
  refreshEnabled,
}: {
  recoveryConfigured: boolean;
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
        <RecoverySetup configured={recoveryConfigured} />
        <CommandMenu refreshEnabled={refreshEnabled} />
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
