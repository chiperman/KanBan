export type TrendRange = "7d" | "30d" | "90d" | "1y" | "all";
export type TrendObservationStatus = "complete" | "incomplete" | "expired";

function daysEndingAt(day: string, count: number): string[] {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(cursor);
    next.setUTCDate(cursor.getUTCDate() - (count - index - 1));
    return next.toISOString().slice(0, 10);
  });
}

function dayCountBetween(startDay: string, endDay: string): number {
  const [startYear, startMonth, startDate] = startDay.split("-").map(Number);
  const [endYear, endMonth, endDate] = endDay.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDate);
  const end = Date.UTC(endYear, endMonth - 1, endDate);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function daysForTrendRange(
  range: TrendRange,
  currentDay: string,
  firstTrendDay?: string,
): string[] {
  if (range === "all" && firstTrendDay) {
    return daysEndingAt(
      currentDay,
      dayCountBetween(firstTrendDay, currentDay),
    );
  }
  const count = range === "7d"
    ? 7
    : range === "90d"
      ? 90
      : range === "1y"
        ? 365
        : 30;
  return daysEndingAt(currentDay, count);
}

export function sourceTrendObservationStatus(input: {
  complete: boolean;
  status?: TrendObservationStatus;
}): TrendObservationStatus {
  return input.status ?? (input.complete ? "complete" : "incomplete");
}

export function totalTrendObservationStatus(
  sources: Array<{
    complete: boolean;
    kind: string;
    status?: TrendObservationStatus;
  }>,
): TrendObservationStatus {
  const automatedSources = sources.filter((source) => source.kind !== "manual");
  if (
    automatedSources.some(
      (source) => sourceTrendObservationStatus(source) === "expired",
    )
  ) {
    return "expired";
  }
  return automatedSources.some(
    (source) => sourceTrendObservationStatus(source) !== "complete",
  )
    ? "incomplete"
    : "complete";
}
