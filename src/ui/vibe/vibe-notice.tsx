import type { HTMLAttributes, ReactNode } from "react";

type VibeNoticeTone = "error" | "info" | "success" | "warning";

interface VibeNoticeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  code?: string;
  tone: VibeNoticeTone;
}

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
      <span aria-hidden="true" className="vibe-notice__marker" />
      <div className="vibe-notice__content">
        {code ? <strong className="vibe-notice__code">{code}</strong> : null}
        <div className="vibe-notice__message">{children}</div>
      </div>
    </div>
  );
}
