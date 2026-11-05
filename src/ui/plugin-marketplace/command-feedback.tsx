import { useEffect, useRef } from "react";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

import type { PluginCommandFailure } from "./requests";

export function PluginCommandFeedback({
  failure,
  focusRecoveryOnMount = false,
  onContinue,
}: {
  failure: PluginCommandFailure | null;
  focusRecoveryOnMount?: boolean;
  onContinue(): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const needsCheck = failure?.outcome === "unconfirmed";
  useEffect(() => {
    if (!focusRecoveryOnMount || !needsCheck) return;
    const frame = window.requestAnimationFrame(() => {
      container.current?.querySelector("a")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRecoveryOnMount, needsCheck]);
  if (!failure) return null;
  return (
    <div className="plugin-marketplace__install" ref={container}>
      <VibeNotice tone={needsCheck ? "warning" : "error"} role="alert">
        {failure.message}
      </VibeNotice>
      {needsCheck ? (
        <div className="plugin-marketplace__actions">
          <VibeLink
            href="/settings?view=plugins"
            target="_blank"
            rel="noreferrer"
            aria-label="核对当前插件（新标签页）"
            wrap
          >
            核对当前插件
          </VibeLink>
          <VibeButton type="button" variant="text" wrap onClick={onContinue}>
            确认未执行，继续操作
          </VibeButton>
        </div>
      ) : null}
    </div>
  );
}
