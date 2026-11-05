const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dateTimeParts(
  formatter: Intl.DateTimeFormat,
  value: string | Date,
): Record<string, string> {
  const date = typeof value === "string" ? new Date(value) : value;

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .map(({ type, value: partValue }) => [type, partValue]),
  );
}

export function formatShanghaiDateTime(value: string | Date): string {
  const parts = dateTimeParts(shanghaiDateTimeFormatter, value);

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatShanghaiShortDateTime(value: string | Date): string {
  const parts = dateTimeParts(shanghaiDateTimeFormatter, value);

  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatShanghaiDayLabel(day: string): string {
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
}

export function formatShanghaiFullDayLabel(day: string): string {
  return `${day.slice(0, 4)}年${formatShanghaiDayLabel(day)}`;
}
