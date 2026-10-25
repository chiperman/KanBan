"use client";

import type {
  FormEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VibeButton } from "@/ui/vibe/vibe-button";

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
  actions: ReactNode | ((requestClose: () => void) => ReactNode);
  children?: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  dirty?: boolean;
  pending?: boolean;
  title: string;
  titleId: string;
}

export function VibeDialog({
  actions,
  children,
  className,
  description,
  headerActions,
  onClose,
  onSubmit,
  dirty = false,
  pending = false,
  title,
  titleId,
  onPointerDown: onOverlayPointerDown,
  ...overlayProps
}: VibeDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const editingFocusRef = useRef("");

  function continueEditing() {
    setConfirmDiscard(false);
    window.requestAnimationFrame(() => {
      const field = document.getElementById(editingFocusRef.current);
      if (field && overlayRef.current?.contains(field)) field.focus();
    });
  }

  function requestClose() {
    if (pending) return;
    if (confirmDiscard) continueEditing();
    else if (dirty) {
      editingFocusRef.current = document.activeElement?.id ?? "";
      setConfirmDiscard(true);
    } else onClose();
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onCloseRef.current = requestClose;
  });

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
          <h2 id={titleId}>{confirmDiscard ? "放弃未保存的修改？" : title}</h2>
        </div>
        {!confirmDiscard && headerActions ? (
          <div className="vibe-dialog__header-actions">{headerActions}</div>
        ) : null}
      </header>
      <div className="vibe-dialog__body">
        {confirmDiscard ? <p className="vibe-dialog__copy">修改尚未保存。</p> : <>
          {description ? <p className="vibe-dialog__copy">{description}</p> : null}
          {children}
        </>}
      </div>
      <footer className="vibe-dialog__footer">{confirmDiscard ? <>
        <VibeButton type="button" variant="text" disabled={pending} onClick={continueEditing}>继续编辑</VibeButton>
        <VibeButton type="button" tone="danger" disabled={pending} onClick={onClose}>放弃修改</VibeButton>
      </> : typeof actions === "function" ? actions(requestClose) : actions}</footer>
    </>
  );
  const panelClassName = ["vibe-dialog", className].filter(Boolean).join(" ");
  const hasExplicitLabel = typeof overlayProps["aria-label"] === "string";

  const dialog = (
    <div
      ref={overlayRef}
      aria-modal="true"
      className="vibe-dialog-overlay"
      data-vibe-component="modal"
      role="dialog"
      {...overlayProps}
      aria-busy={pending || overlayProps["aria-busy"]}
      aria-label={confirmDiscard ? undefined : overlayProps["aria-label"]}
      aria-labelledby={confirmDiscard ? titleId : overlayProps["aria-labelledby"] ?? (hasExplicitLabel ? undefined : titleId)}
      onPointerDown={(event) => {
        onOverlayPointerDown?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      {onSubmit ? (
        <form className={panelClassName} onSubmit={event => {
          if (confirmDiscard || pending) event.preventDefault();
          else onSubmit(event);
        }}>
          {panelContent}
        </form>
      ) : (
        <section className={panelClassName}>{panelContent}</section>
      )}
    </div>
  );

  return mounted ? createPortal(dialog, document.body) : dialog;
}
