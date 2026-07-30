"use client";

import { useEffect, useState } from "react";

import { formatShanghaiTime } from "@/ui/shanghai-date-time";

interface ShanghaiClockProps {
  initialTime: string;
  compact?: boolean;
}

export function ShanghaiClock({ initialTime, compact = false }: ShanghaiClockProps) {
  const [now, setNow] = useState(() => new Date(initialTime));

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      className={compact ? "header-time" : "locked-clock"}
      dateTime={now.toISOString()}
      data-testid="server-time"
      aria-label="上海当前时间"
    >
      <span>SHANGHAI /</span>
      <strong>{formatShanghaiTime(now)}</strong>
    </time>
  );
}
