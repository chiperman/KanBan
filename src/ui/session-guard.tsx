"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  OWNER_LOCK_EVENT,
} from "@/shared/session-policy";
import { trackSessionActivity } from "@/ui/session-activity";
import { VibeDotIcon } from "@/ui/vibe/vibe-dot-icon";

/** 锁定罩的最小停留时间，让“已锁定”状态可被感知后再跳转登录入口。 */
const LOCK_VEIL_MIN_DWELL_MS = 900;
const LOCK_VEIL_MIN_DWELL_REDUCED_MOTION_MS = 300;
/** 锁定罩淡出到纯背景色的时长，与登录门的淡入衔接成连续过渡。 */
const LOCK_VEIL_DEPART_MS = 220;

export function SessionGuard({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [departing, setDeparting] = useState(false);

  useEffect(() => {
    if (locked) return;
    function lock() { setLocked(true); }
    const tracker = trackSessionActivity({
      notify: (signal) => fetch("/api/auth/session/activity", { method: "POST", signal }),
      lock,
      visible: () => document.visibilityState === "visible",
    });
    const activity = tracker.activity;
    document.addEventListener("visibilitychange", tracker.visibilityChanged);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("touchstart", activity);
    window.addEventListener(OWNER_LOCK_EVENT, lock);
    return () => {
      tracker.dispose();
      document.removeEventListener("visibilitychange", tracker.visibilityChanged);
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
    const lockedAt = Date.now();
    const minDwellMs = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? LOCK_VEIL_MIN_DWELL_REDUCED_MOTION_MS
      : LOCK_VEIL_MIN_DWELL_MS;

    async function destroyServerSession() {
      try {
        // 挂起的注销会让锁定后一直重试不到服务端；超时后走既有重试路径。
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const waitMs = Math.max(0, minDwellMs - (Date.now() - lockedAt));
          retry = setTimeout(() => {
            if (!cancelled) setDeparting(true);
          }, waitMs);
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

  useEffect(() => {
    if (!departing) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(
      () => window.location.reload(),
      reduceMotion ? 0 : LOCK_VEIL_DEPART_MS,
    );
    return () => clearTimeout(timer);
  }, [departing]);

  return locked ? (
    <section
      className={departing ? "session-locked is-departing" : "session-locked"}
      role="status"
    >
      <span className="session-locked-veil" aria-hidden="true" />
      <span className="session-locked-content">
        <span className="session-locked-icon">
          <VibeDotIcon name="lock" size={72} />
        </span>
        <p className="empty-title">敏感内容已锁定</p>
        <p className="empty-hint">正在锁定…</p>
      </span>
      <span className="session-locked-curtain" aria-hidden="true" />
    </section>
  ) : (
    children
  );
}
