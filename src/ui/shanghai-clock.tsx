"use client";

import { useEffect, useState } from "react";

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

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .split(":");

  return (
    <time
      className={compact ? "header-time" : "locked-clock"}
      dateTime={now.toISOString()}
      data-testid="server-time"
      aria-label="上海当前时间"
    >
      <span>SHANGHAI /</span>
      <strong>
        {timeParts[0]}:{timeParts[1]}:{timeParts[2]}
      </strong>
    </time>
  );
}
