"use client";

import { useEffect, useMemo, useState } from "react";

const INITIAL_TIME_ZONE = "Asia/Shanghai";

interface LocalClockProps {
  initialTime: string;
  compact?: boolean;
}

function formatTime(formatter: Intl.DateTimeFormat, value: Date): string {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .map(({ type, value: partValue }) => [type, partValue]),
  );

  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatTimeZoneLabel(timeZone: string): string {
  const location = timeZone.split("/").at(-1) || timeZone;

  return location.replaceAll("_", " ").toUpperCase();
}

export function LocalClock({ initialTime, compact = false }: LocalClockProps) {
  const [now, setNow] = useState(() => new Date(initialTime));
  const [timeZone, setTimeZone] = useState(INITIAL_TIME_ZONE);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    [timeZone],
  );

  useEffect(() => {
    const updateNow = () => {
      setNow(new Date());
      setTimeZone(
        Intl.DateTimeFormat().resolvedOptions().timeZone || INITIAL_TIME_ZONE,
      );
    };

    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      className={compact ? "header-time" : "locked-clock"}
      dateTime={now.toISOString()}
      data-testid="local-time"
      data-time-zone={timeZone}
      aria-label={`当前本地时间，时区 ${timeZone}`}
    >
      <span>{formatTimeZoneLabel(timeZone)} /</span>
      <strong>{formatTime(formatter, now)}</strong>
    </time>
  );
}
