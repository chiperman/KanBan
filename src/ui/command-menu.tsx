"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { ASSET_MANUAL_REFRESH_EVENT } from "@/shared/command-events";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeField } from "@/ui/vibe/vibe-field";

interface NavigationTarget {
  id: string;
  label: string;
}

interface Command {
  id: string;
  label: string;
  detail: string;
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

export function CommandMenu({ refreshEnabled }: { refreshEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<NavigationTarget[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function close(returnFocus = true) {
    setOpen(false);
    setQuery("");
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function show() {
    setTargets(navigationTargets());
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
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
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const navigation = targets.map((target) => ({
      id: `navigate:${target.id}`,
      label: `跳转到 ${target.label}`,
      detail: "卡片导航",
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
    }));
    const actions: Command[] = [];
    if (refreshEnabled) {
      actions.push({
        id: "refresh",
        label: "立即刷新资产",
        detail: "资产动作",
        keywords: "立即 刷新 同步 资产 refresh",
        action() {
          close(false);
          window.dispatchEvent(new Event(ASSET_MANUAL_REFRESH_EVENT));
        },
      });
    }
    actions.push({
      id: "lock",
      label: "立即锁定敏感内容",
      detail: "会话动作",
      keywords: "立即 锁定 退出 敏感内容 lock",
      action() {
        close(false);
        window.dispatchEvent(new Event(OWNER_LOCK_EVENT));
      },
    });
    return [...navigation, ...actions];
  }, [refreshEnabled, targets]);

  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = commands.filter((command) =>
    `${command.label} ${command.keywords}`.toLocaleLowerCase("zh-CN").includes(normalized),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        (current + direction + filtered.length) % filtered.length,
      );
      return;
    }
    if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      filtered[activeIndex].action();
      return;
    }
    if (event.key === "Tab") {
      const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
        'input, button:not([disabled])',
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
      }
    }
  }

  return (
    <>
      <VibeButton
        ref={triggerRef}
        type="button"
        className="header-action-button command-menu-trigger"
        aria-label="打开快捷命令"
        onClick={show}
        variant="outline"
      >
        快捷命令 <kbd>⌘K</kbd>
      </VibeButton>
      {open ? (
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
                <p className="command-menu-eyebrow">COMMAND PALETTE · 快捷命令</p>
                <p className="command-menu-hint">⌘K · Ctrl K · Esc 关闭</p>
              </div>
              <VibeButton
                type="button"
                className="command-menu-close"
                onClick={() => close()}
                variant="text"
              >
                关闭
              </VibeButton>
            </header>
            <div className="command-menu-search">
              <VibeField
                ref={searchRef}
                fieldId="command-menu-search"
                label="搜索命令"
                type="search"
                role="searchbox"
                aria-label="搜索命令"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索卡片、刷新或锁定"
              />
            </div>
            <div className="command-menu-results" aria-live="polite">
              {filtered.length === 0 ? (
                <p className="command-menu-empty">没有匹配的命令</p>
              ) : (
                filtered.map((command, index) => (
                  <VibeButton
                    key={command.id}
                    type="button"
                    className="command-menu-item"
                    data-active={index === activeIndex ? "true" : "false"}
                    aria-label={command.label}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={command.action}
                    variant="text"
                  >
                    <span>{command.label}</span>
                    <small>{command.detail}</small>
                  </VibeButton>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
