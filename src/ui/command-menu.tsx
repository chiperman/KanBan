"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { WORKBENCH_DESTINATIONS } from "@/ui/workbench-navigation";
import { OWNER_LOCK_EVENT } from "@/shared/session-policy";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeIcon } from "@/ui/vibe/vibe-icon";

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

export function CommandMenu({ refreshEnabled }: { refreshEnabled: boolean }) {
  const router = useRouter();
  const refresh = useAssetRefresh();
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
      if (event.isComposing) return;
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
          close(false);
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
    if (event.target === searchRef.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (filtered.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        (current + direction + filtered.length) % filtered.length,
      );
      return;
    }
    if (event.target === searchRef.current && event.key === "Enter" && filtered[activeIndex]) {
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
        className="command-menu-trigger"
        aria-label="打开快捷命令"
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
                <p className="command-menu-hint">⌘K · Ctrl K · Esc 关闭</p>
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
                fieldId="command-menu-search"
                label="搜索命令"
                type="search"
                role="searchbox"
                aria-label="搜索命令"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="command-menu-results" aria-live="polite">
              {filtered.length === 0 ? (
                <p className="command-menu-empty">无匹配命令</p>
              ) : (
                filtered.map((command, index) => (
                  <VibeButton
                    key={command.id}
                    type="button"
                    data-active={index === activeIndex ? "true" : "false"}
                    aria-label={command.label}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={command.action}
                    variant="text"
                  >
                    <span>{command.label}</span>
                  </VibeButton>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
