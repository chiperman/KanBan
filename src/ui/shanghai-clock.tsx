"use client";

import { useEffect, useState } from "react";

interface ShanghaiClockProps {
  initialTime: string;
}

export function ShanghaiClock({ initialTime }: ShanghaiClockProps) {
  const initialTimestamp = Date.parse(initialTime);
  const [now, setNow] = useState(() => new Date(initialTimestamp));

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setNow(new Date(initialTimestamp + Date.now() - startedAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [initialTimestamp]);

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
      className="locked-clock"
      dateTime={now.toISOString()}
      data-testid="server-time"
      aria-label="上海当前时间"
    >
      <span>SHANGHAI /</span>
      <strong>
        {timeParts[0]}:{timeParts[1]}:{timeParts[2]}
      </strong>
      <small>/ UTC+08</small>
    </time>
  );
}
