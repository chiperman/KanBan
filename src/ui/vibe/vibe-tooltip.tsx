"use client";

import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

interface TooltipTriggerProps {
  "aria-describedby"?: string;
}

export function VibeTooltip({
  align = "center",
  children,
  label,
  side = "bottom",
}: {
  align?: "center" | "end";
  children: ReactElement<TooltipTriggerProps>;
  label: string;
  side?: "bottom" | "right";
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open || side !== "right") return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const content = contentRef.current?.getBoundingClientRect();
    if (!trigger || !content) return;
    const left = trigger.right + 8 + content.width <= window.innerWidth - 8
      ? trigger.right + 8
      : Math.max(8, trigger.left - content.width - 8);
    setPosition({ left, top: Math.max(8, Math.min(trigger.top + (trigger.height - content.height) / 2, window.innerHeight - content.height - 8)) });
    const dismiss = () => setOpen(false);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open, side, label]);
  const describedBy = [
    children.props?.["aria-describedby"],
    tooltipId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="vibe-tooltip" data-align={align} ref={triggerRef}
      onPointerEnter={(event) => side === "right" && event.pointerType !== "touch" && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => side === "right" && setOpen(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      {side === "right" ? open && createPortal(
        <span className="vibe-tooltip__content vibe-tooltip__content--floating" id={tooltipId}
          ref={contentRef} role="tooltip" style={position}>{label}</span>,
        document.body,
      ) : <span className="vibe-tooltip__content" id={tooltipId} role="tooltip">
        {label}
      </span>}
    </span>
  );
}
