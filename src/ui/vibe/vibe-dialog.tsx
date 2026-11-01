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
    .filter((element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0,
    );
}

export interface VibeDialogConfirmation {
  title: string;
  description?: ReactNode;
  actions: ReactNode;
  onCancel(): void;
}

interface VibeDialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit" | "title"> {
  actions: ReactNode | ((requestClose: () => void) => ReactNode);
  children?: ReactNode;
  confirmation?: VibeDialogConfirmation;
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
  confirmation,
  description,
  headerActions,
  onClose,
  onSubmit,
  dirty = false,
  pending = false,
  title,
  titleId,
  onClickCapture: onOverlayClickCapture,
  onFocusCapture: onOverlayFocusCapture,
  onKeyDownCapture: onOverlayKeyDownCapture,
  onPointerDown: onOverlayPointerDown,
  ...overlayProps
}: VibeDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const editingPanelRef = useRef<HTMLElement | null>(null);
  const confirmationPanelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const editingFocusRef = useRef<HTMLElement | null>(null);
  const activationViewRef = useRef(false);

  function continueEditing() {
    setConfirmDiscard(false);
  }

  function requestClose() {
    if (pending) return;
    if (activeConfirmation) activeConfirmation.onCancel();
    else if (dirty) {
      setConfirmDiscard(true);
    } else onClose();
  }

  const activeConfirmation = confirmation ?? (confirmDiscard ? {
    title: "放弃当前输入？",
    description: "关闭后将丢弃当前输入。",
    onCancel: continueEditing,
    actions: <>
      <VibeButton type="button" variant="text" disabled={pending} onClick={continueEditing}>继续编辑</VibeButton>
      <VibeButton type="button" tone="danger" disabled={pending} onClick={onClose}>放弃修改</VibeButton>
    </>,
  } : undefined);
  const confirming = !!activeConfirmation;
  const confirmationTitleId = `${titleId}-confirmation`;
  const confirmationDescriptionId = `${confirmationTitleId}-description`;

  function acceptsActivation(continuing: boolean) {
    // 连续点击和按键连发不能跨过确认视图，新一次操作正常执行。
    if (continuing && activationViewRef.current !== confirming) return false;
    activationViewRef.current = confirming;
    return true;
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
      const scope = confirmationPanelRef.current ?? overlayRef.current;
      const controls = dialogControls(scope);
      if (controls.length === 0) {
        event.preventDefault();
        overlayRef.current?.focus();
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
      } else if (!scope?.contains(document.activeElement)) {
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
    if (confirming) return;
    const frame = window.requestAnimationFrame(() => {
      const field = editingFocusRef.current;
      if (
        field?.isConnected &&
        editingPanelRef.current?.contains(field) &&
        !field.matches(":disabled") &&
        field.getClientRects().length > 0
      ) field.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirming]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const scope = confirmationPanelRef.current ?? overlay;
      const active = document.activeElement;
      if (
        active !== overlay &&
        scope.contains(active) &&
        active instanceof HTMLElement &&
        !active.matches(":disabled") &&
        !active.closest("[inert]") &&
        active.getClientRects().length > 0
      ) return;
      (dialogControls(scope)[0] ?? overlay).focus();
    });
    return () => window.cancelAnimationFrame(frame);
  });

  const panelContent = (
    <>
      <header className="vibe-dialog__header">
        <div className="vibe-dialog__heading">
          <h2 id={titleId}>{title}</h2>
        </div>
        {headerActions ? (
          <div className="vibe-dialog__header-actions">{headerActions}</div>
        ) : null}
      </header>
      <div className="vibe-dialog__body">
        {description ? <p className="vibe-dialog__copy">{description}</p> : null}
        {children}
      </div>
      <footer className="vibe-dialog__footer">{typeof actions === "function" ? actions(requestClose) : actions}</footer>
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
      tabIndex={-1}
      {...overlayProps}
      aria-busy={pending || overlayProps["aria-busy"]}
      aria-label={confirming ? undefined : overlayProps["aria-label"]}
      aria-labelledby={confirming
        ? confirmationTitleId
        : overlayProps["aria-labelledby"] ?? (hasExplicitLabel ? undefined : titleId)}
      aria-describedby={confirming
        ? (activeConfirmation.description ? confirmationDescriptionId : undefined)
        : overlayProps["aria-describedby"]}
      onClickCapture={(event) => {
        if (!acceptsActivation(event.detail > 1)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onOverlayClickCapture?.(event);
      }}
      onFocusCapture={(event) => {
        onOverlayFocusCapture?.(event);
        if (
          !confirming &&
          event.target instanceof HTMLElement &&
          editingPanelRef.current?.contains(event.target)
        ) editingFocusRef.current = event.target;
      }}
      onKeyDownCapture={(event) => {
        if (!acceptsActivation(event.repeat)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onOverlayKeyDownCapture?.(event);
      }}
      onPointerDown={(event) => {
        onOverlayPointerDown?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      {/* 确认视图独立于保存表单，隐藏时保留草稿、校验和控件身份。 */}
      {onSubmit ? (
        <form
          ref={node => { editingPanelRef.current = node; }}
          className={panelClassName}
          hidden={confirming}
          inert={confirming}
          onSubmit={event => {
            if (confirming || pending) event.preventDefault();
            else onSubmit(event);
          }}
        >
          {panelContent}
        </form>
      ) : (
        <section
          ref={node => { editingPanelRef.current = node; }}
          className={panelClassName}
          hidden={confirming}
          inert={confirming}
        >
          {panelContent}
        </section>
      )}
      {activeConfirmation ? (
        <section ref={confirmationPanelRef} className={panelClassName}>
          <header className="vibe-dialog__header">
            <div className="vibe-dialog__heading">
              <h2 id={confirmationTitleId}>{activeConfirmation.title}</h2>
            </div>
          </header>
          <div className="vibe-dialog__body">
            {activeConfirmation.description ? (
              <p className="vibe-dialog__copy" id={confirmationDescriptionId}>{activeConfirmation.description}</p>
            ) : null}
          </div>
          <footer className="vibe-dialog__footer">{activeConfirmation.actions}</footer>
        </section>
      ) : null}
    </div>
  );

  return mounted ? createPortal(dialog, document.body) : dialog;
}
