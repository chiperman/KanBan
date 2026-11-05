"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { VibeButton } from "@/ui/vibe/vibe-button";

export interface VibeMenuItem {
  key: string;
  label: string;
  tone?: "default" | "danger";
  onSelect(): void;
}

function menuItems(root: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ].filter((item) => !item.disabled);
}

export function VibeMenu({
  items,
  label,
  triggerLabel = "更多操作",
  triggerVariant = "text",
}: {
  items: VibeMenuItem[];
  label: string;
  triggerLabel?: string;
  triggerVariant?: "primary" | "outline" | "text";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menuItems(rootRef.current)[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveFocus(
    event: KeyboardEvent<HTMLElement>,
    destination: "next" | "previous" | "first" | "last",
  ) {
    const options = menuItems(rootRef.current);
    if (options.length === 0) return;
    const currentIndex = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      destination === "first"
        ? 0
        : destination === "last"
          ? options.length - 1
          : destination === "next"
            ? (currentIndex + 1) % options.length
            : (currentIndex - 1 + options.length) % options.length;
    event.preventDefault();
    options[nextIndex]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="vibe-menu"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          closeAndFocusTrigger();
        } else if (event.key === "ArrowDown" && open) {
          moveFocus(event, "next");
        } else if (event.key === "ArrowUp" && open) {
          moveFocus(event, "previous");
        } else if (event.key === "Home" && open) {
          moveFocus(event, "first");
        } else if (event.key === "End" && open) {
          moveFocus(event, "last");
        }
      }}
    >
      <VibeButton
        ref={triggerRef}
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="vibe-menu__trigger"
        onClick={() => setOpen((current) => !current)}
        variant={triggerVariant}
      >
        {triggerLabel}
      </VibeButton>
      {open ? (
        <div
          id={menuId}
          aria-label={label}
          className="vibe-menu__panel"
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`vibe-menu__item${item.tone === "danger" ? " vibe-menu__item--danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              role="menuitem"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
