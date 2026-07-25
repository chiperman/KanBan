"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  OWNER_LOCK_EVENT,
  SESSION_IDLE_TIMEOUT_MS,
} from "@/shared/session-policy";

export function SessionGuard({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (locked) return;
    let timeout: ReturnType<typeof setTimeout>;

    function lock() {
      setLocked(true);
    }

    function schedule() {
      clearTimeout(timeout);
      timeout = setTimeout(lock, SESSION_IDLE_TIMEOUT_MS);
    }

    function activity() {
      schedule();
      void fetch("/api/auth/session/activity", { method: "POST" })
        .then((response) => {
          if (!response.ok) {
            setLocked(true);
            window.location.reload();
          }
        })
        .catch(() => undefined);
    }

    schedule();
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("touchstart", activity);
    window.addEventListener(OWNER_LOCK_EVENT, lock);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("touchstart", activity);
      window.removeEventListener(OWNER_LOCK_EVENT, lock);
    };
  }, [locked]);

  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;

    async function destroyServerSession() {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (response.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // 保持本地锁定，并继续重试服务端会话销毁。
      }
      if (!cancelled) retry = setTimeout(destroyServerSession, 1000);
    }

    void destroyServerSession();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [locked]);

  return locked ? (
    <section className="session-locked" role="status">
      <p className="empty-title">敏感内容已锁定</p>
      <p className="empty-hint">正在确认服务端锁定，完成后可重新验证身份。</p>
    </section>
  ) : (
    children
  );
}
