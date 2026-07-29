import type { HTMLAttributes, ReactNode } from "react";

import {
  VibeDotIcon,
  type VibeDotIconName,
} from "@/ui/vibe/vibe-dot-icon";

type VibeNoticeTone = "error" | "info" | "success";

interface VibeNoticeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  code?: string;
  tone: VibeNoticeTone;
}

const ICON_BY_TONE: Record<VibeNoticeTone, VibeDotIconName> = {
  error: "error",
  info: "key",
  success: "check",
};

export function VibeNotice({
  children,
  className,
  code,
  tone,
  ...props
}: VibeNoticeProps) {
  const classes = ["vibe-notice", `vibe-notice--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-vibe-component="notice"
      data-vibe-tone={tone}
      {...props}
    >
      <VibeDotIcon name={ICON_BY_TONE[tone]} />
      <div className="vibe-notice__content">
        {code ? <strong className="vibe-notice__code">{code}</strong> : null}
        <div className="vibe-notice__message">{children}</div>
      </div>
    </div>
  );
}
