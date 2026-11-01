"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { WORKBENCH_DESTINATIONS } from "@/ui/workbench-navigation";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import type { VibeTooltipTriggerProps } from "@/ui/vibe/vibe-tooltip";

interface NavigationTarget {
  id: string;
  label: string;
}

interface Command {
  id: string;
  label: string;
  keywords: string;
  action(): void;
}

function navigationTargets(): NavigationTarget[] {
  return [...document.querySelectorAll<HTMLElement>("[data-command-target]")]
    .flatMap((element) => {
      const id = element.dataset.commandTarget;
      const label = element.dataset.commandLabel;
      return id && label ? [{ id, label }] : [];
    });
}

export function CommandMenu({
  refreshEnabled,
  "aria-describedby": describedBy,
}: VibeTooltipTriggerProps & { refreshEnabled: boolean }) {
  const router = useRouter();
  const refresh = useAssetRefresh();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<NavigationTarget[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const menuId = useId();
  const resultsId = `${menuId}-results`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const returnFocusFrameRef = useRef<number | null>(null);

  function close(returnFocus = true) {
    setOpen(false);
    setQuery("");
    if (returnFocus) {
      const invoker = invokerRef.current;
      returnFocusFrameRef.current = requestAnimationFrame(() => {
        const destination = invoker?.isConnected && !invoker.matches(":disabled")
          ? invoker
          : triggerRef.current;
        destination?.focus();
        returnFocusFrameRef.current = null;
      });
    }
  }

  function show() {
    if (returnFocusFrameRef.current !== null) {
      cancelAnimationFrame(returnFocusFrameRef.current);
      returnFocusFrameRef.current = null;
    }
    invokerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setTargets(navigationTargets());
    setQuery("");
    setActiveId(null);
    setOpen(true);
  }

  useEffect(() => () => {
    if (returnFocusFrameRef.current !== null) {
      cancelAnimationFrame(returnFocusFrameRef.current);
    }
  }, []);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else show();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const navigation = [
      ...[...WORKBENCH_DESTINATIONS, { href: "/settings?view=data", label: "数据与维护" }].map(({ href, label }) => ({
        id: `workbench:${href}`,
        label: `前往${label}`,
        keywords: `${label} 前往 跳转 导航 工作台`,
        action() {
          close(false);
          router.push(href);
        },
      })),
      ...targets.map((target) => ({
        id: `navigate:${target.id}`,
        label: `跳转到 ${target.label}`,
        keywords: `${target.label} 跳转 导航 卡片`,
        action() {
          close(false);
          requestAnimationFrame(() => {
            const element = document.querySelector<HTMLElement>(
              `[data-command-target="${CSS.escape(target.id)}"]`,
            );
            if (!element) return;
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            element.scrollIntoView({
              behavior: reducedMotion ? "auto" : "smooth",
              block: "center",
            });
            element.focus({ preventScroll: true });
            element.dataset.commandHighlight = "true";
            window.setTimeout(() => delete element.dataset.commandHighlight, 900);
          });
        },
      })),
    ];
    const actions: Command[] = [];
    if (refreshEnabled && refresh.canRefresh) {
      actions.push({
        id: "refresh",
        label: "立即刷新资产",
        keywords: "立即 刷新 同步 资产 refresh",
        action() {
          close();
          void refresh.request({ reason: "manual-global" });
        },
      });
    }
    actions.push({
      id: "lock",
      label: "立即锁定敏感内容",
      keywords: "立即 锁定 退出 敏感内容 lock",
      action() {
        close(false);
        window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
      },
    });
    return [...navigation, ...actions];
  }, [refresh, refreshEnabled, router, targets]);

  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = commands.filter((command) =>
    `${command.label} ${command.keywords}`.toLocaleLowerCase("zh-CN").includes(normalized),
  );
  const activeCommand = filtered.find((command) => command.id === activeId) ?? filtered[0];
  const activeOptionId = activeCommand
    ? `${menuId}-option-${encodeURIComponent(activeCommand.id)}`
    : undefined;

  if (activeId !== null && !filtered.some((command) => command.id === activeId)) {
    setActiveId(null);
  }

  useEffect(() => {
    if (open && activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    }
  }, [open, activeOptionId]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.target === searchRef.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (filtered.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const currentIndex = filtered.findIndex((command) => command.id === activeCommand?.id);
      setActiveId(filtered[(currentIndex + direction + filtered.length) % filtered.length].id);
      return;
    }
    if (event.target === searchRef.current && event.key === "Enter") {
      event.preventDefault();
      activeCommand?.action();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
        'input, button',
      )].filter((element) =>
        element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!event.currentTarget.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <>
      <VibeButton
        ref={triggerRef}
        type="button"
        className="command-menu-trigger"
        aria-label="打开快捷命令"
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        variant="outline"
      >
        <VibeIcon name="search" />
        <span className="workbench-control-label">快捷命令</span>
        <kbd>⌘K</kbd>
      </VibeButton>
      {open ? createPortal(
        <div
          className="command-menu-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="快捷命令"
          data-vibe-component="command-menu"
          onKeyDown={keyboard}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div className="command-menu-panel" data-vibe-surface="command-panel">
            <header className="command-menu-head">
              <div>
                <p className="command-menu-eyebrow">快捷命令</p>
              </div>
              <VibeButton
                type="button"
                onClick={() => close()}
                variant="text"
              >
                关闭
              </VibeButton>
            </header>
            <div className="command-menu-search">
              <VibeField
                ref={searchRef}
                fieldId={`${menuId}-search`}
                label="搜索命令"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={resultsId}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveId(null);
                }}
              />
            </div>
            <div className="command-menu-results">
              <div className="command-menu-list" id={resultsId} role="listbox" aria-label="命令">
                {filtered.map((command) => (
                  <VibeButton
                    key={command.id}
                    className="command-menu-item"
                    id={`${menuId}-option-${encodeURIComponent(command.id)}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={command.id === activeCommand?.id}
                    onMouseMove={() => setActiveId(command.id)}
                    onMouseDown={(event) => {
                      if (event.button === 0) event.preventDefault();
                    }}
                    onClick={command.action}
                    variant="text"
                  >
                    <span>{command.label}</span>
                  </VibeButton>
                ))}
              </div>
              {filtered.length === 0 ? (
                <p className="command-menu-empty" role="status">无匹配命令</p>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
