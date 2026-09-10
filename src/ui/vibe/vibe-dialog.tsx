"use client";

import type {
  FormEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function dialogControls(overlay: HTMLElement | null): HTMLElement[] {
  return [...(overlay?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
    .filter((element) => element.getClientRects().length > 0);
}

interface VibeDialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit" | "title"> {
  actions: ReactNode;
  children?: ReactNode;
  description: ReactNode;
  eyebrow?: string;
  headerActions?: ReactNode;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  title: string;
  titleId: string;
}

export function VibeDialog({
  actions,
  children,
  className,
  description,
  eyebrow,
  headerActions,
  onClose,
  onSubmit,
  title,
  titleId,
  ...overlayProps
}: VibeDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function keyboard(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogControls(overlayRef.current);
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!overlayRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const overlay = overlayRef.current;
      if (!overlay || overlay.contains(document.activeElement)) return;
      dialogControls(overlay)[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  });

  const panelContent = (
    <>
      <header className="vibe-dialog__header">
        <div className="vibe-dialog__heading">
          {eyebrow ? <p className="vibe-dialog__eyebrow">{eyebrow}</p> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
        {headerActions ? (
          <div className="vibe-dialog__header-actions">{headerActions}</div>
        ) : null}
      </header>
      <div className="vibe-dialog__body">
        <p className="vibe-dialog__copy">{description}</p>
        {children}
      </div>
      <footer className="vibe-dialog__footer">{actions}</footer>
    </>
  );
  const panelClassName = ["vibe-dialog", className].filter(Boolean).join(" ");
  const hasExplicitLabel = typeof overlayProps["aria-label"] === "string";

  const dialog = (
    <div
      ref={overlayRef}
      aria-labelledby={hasExplicitLabel ? undefined : titleId}
      aria-modal="true"
      className="vibe-dialog-overlay"
      data-vibe-component="modal"
      role="dialog"
      {...overlayProps}
    >
      {onSubmit ? (
        <form className={panelClassName} onSubmit={onSubmit}>
          {panelContent}
        </form>
      ) : (
        <section className={panelClassName}>{panelContent}</section>
      )}
    </div>
  );

  return mounted ? createPortal(dialog, document.body) : dialog;
}
