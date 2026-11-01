"use client";

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

export interface VibeTooltipTriggerProps {
  "aria-describedby"?: string;
}

type TooltipPlacement = "bottom" | "right" | "top" | "left";

export function VibeTooltip({
  align = "center",
  children,
  label,
  side = "bottom",
}: {
  align?: "center" | "end";
  children: ReactElement<VibeTooltipTriggerProps>;
  label: string;
  side?: "bottom" | "right";
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [interaction, setInteraction] = useState({
    hovered: false,
    focused: false,
    dismissed: false,
  });
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    arrowLeft: number;
    side: TooltipPlacement;
  }>({
    left: 0,
    top: 0,
    arrowLeft: 0,
    side,
  });
  const open = (interaction.hovered || interaction.focused) && !interaction.dismissed;

  useEffect(() => {
    setPortalRoot(
      triggerRef.current?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open || !portalRoot) return;
    function updatePosition() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const content = contentRef.current?.getBoundingClientRect();
      if (!trigger || !content) return;
      const gap = 8;
      const padding = 8;
      let placement: TooltipPlacement;
      let preferredLeft: number;
      let preferredTop: number;
      if (side === "right") {
        const fitsRight = trigger.right + gap + content.width <= window.innerWidth - padding;
        placement = fitsRight ? "right" : "left";
        preferredLeft = fitsRight ? trigger.right + gap : trigger.left - content.width - gap;
        preferredTop = trigger.top + (trigger.height - content.height) / 2;
      } else {
        const fitsBelow = trigger.bottom + gap + content.height <= window.innerHeight - padding;
        placement = fitsBelow ? "bottom" : "top";
        preferredLeft = align === "end"
          ? trigger.right - content.width
          : trigger.left + (trigger.width - content.width) / 2;
        preferredTop = fitsBelow ? trigger.bottom + gap : trigger.top - content.height - gap;
      }
      const left = Math.max(padding, Math.min(preferredLeft, window.innerWidth - content.width - padding));
      const top = Math.max(padding, Math.min(preferredTop, window.innerHeight - content.height - padding));
      const arrowLeft = Math.max(12, Math.min(trigger.left + trigger.width / 2 - left, content.width - 12));
      setPosition((current) =>
        current.left === left && current.top === top && current.arrowLeft === arrowLeft && current.side === placement
          ? current
          : { left, top, arrowLeft, side: placement },
      );
    }
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [open, portalRoot, side, align, label]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setInteraction((current) => ({ ...current, dismissed: true }));
    const dismissOnScroll = (event: Event) => {
      if (event.target instanceof Node && contentRef.current?.contains(event.target)) return;
      dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      window.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  function containsTarget(target: EventTarget | null) {
    return target instanceof Node &&
      (triggerRef.current?.contains(target) || contentRef.current?.contains(target));
  }

  const describedBy = [
    children.props?.["aria-describedby"],
    tooltipId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className="vibe-tooltip"
      ref={triggerRef}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch" && containsTarget(event.target)) {
          setInteraction((current) => ({ ...current, hovered: true, dismissed: false }));
        }
      }}
      onPointerLeave={(event) => {
        if (containsTarget(event.target) && !containsTarget(event.relatedTarget)) {
          setInteraction((current) => ({ ...current, hovered: false }));
        }
      }}
      onFocus={(event) => {
        // React Portal 的焦点事件会冒泡；业务弹窗接管焦点时收起原按钮提示。
        if (event.currentTarget.contains(event.target)) {
          setInteraction((current) => ({ ...current, focused: true, dismissed: false }));
        } else {
          setInteraction({ hovered: false, focused: false, dismissed: true });
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.target) && !event.currentTarget.contains(event.relatedTarget)) {
          setInteraction((current) => ({ ...current, focused: false }));
        }
      }}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      {portalRoot ? createPortal(
        <span
          className="vibe-tooltip__content"
          data-side={position.side}
          hidden={!open}
          id={tooltipId}
          ref={contentRef}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >
          {label}
          <span aria-hidden="true" className="vibe-tooltip__arrow" style={{ left: position.arrowLeft }} />
        </span>,
        portalRoot,
      ) : null}
    </span>
  );
}
