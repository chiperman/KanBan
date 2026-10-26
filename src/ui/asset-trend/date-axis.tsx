import { XAxis, usePlotArea, type XAxisTickContentProps } from "recharts";

import type { AssetTrendChartPoint } from "./shared";

export function AssetTrendDateTick({
  x,
  y,
  index,
  visibleTicksCount,
  payload,
  tickFormatter,
}: XAxisTickContentProps) {
  return (
    <text
      className="recharts-cartesian-axis-tick-value"
      x={x}
      y={y}
      dy="0.71em"
      fill="var(--muted)"
      fontFamily="var(--f-display)"
      fontSize={12}
      textAnchor={
        visibleTicksCount === 1
          ? "middle"
          : index === 0
            ? "start"
            : index === visibleTicksCount - 1
              ? "end"
              : "middle"
      }
    >
      {tickFormatter ? tickFormatter(payload.value, index) : payload.value}
    </text>
  );
}

type CalendarDateTick = {
  day: string;
  label: string;
  year: string | null;
  textAnchor: "start" | "middle" | "end";
};

export function calendarAssetTrendTicks(
  days: readonly string[],
  plotWidth: number,
): CalendarDateTick[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days.at(-1)!;
  const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  const monthly = spanDays > 62;
  const width = Math.max(0, plotWidth);
  const minGap = monthly ? 44 : 56;
  const steps = monthly ? [1, 2, 3, 6, 12, 24, 60, 120] : [1, 2, 3, 7, 14, 28, 56];
  const position = (index: number) =>
    days.length === 1 ? width / 2 : (index / (days.length - 1)) * width;
  const candidatesForStep = (step: number) =>
    days.flatMap((day, index) => {
      if (index === 0) return [{ day, index }];
      if (monthly) {
        const month = Number(day.slice(5, 7)) - 1;
        const monthIndex = Number(day.slice(0, 4)) * 12 + month;
        return day.slice(0, 7) !== days[index - 1].slice(0, 7) && monthIndex % step === 0
          ? [{ day, index }]
          : [];
      }
      const offset = (Date.parse(day) - Date.parse(first)) / 86_400_000;
      return offset % step === 0 || day.endsWith("-01-01") || index === days.length - 1
        ? [{ day, index }]
        : [];
    });
  // Measure actual calendar spacing so February does not break an otherwise monthly cadence.
  const step =
    steps.find((value) => {
      if (!monthly) return (spanDays / value) * minGap <= width;
      const regularTicks = candidatesForStep(value).slice(1);
      return regularTicks
        .slice(1)
        .every(
          (tick, index) => position(tick.index) - position(regularTicks[index].index) >= minGap,
        );
    }) ?? steps.at(-1)!;
  const candidates = candidatesForStep(step);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (previous && position(candidate.index) - position(previous.index) < minGap) {
      const entersYear = candidate.day.slice(0, 4) !== previous.day.slice(0, 4);
      const finalDay = !monthly && candidate.day === last && selected.length > 1;
      if (!entersYear && !finalDay) continue;
      // Keep the year boundary (or short-range endpoint), not a nearby redundant label.
      selected.pop();
    }
    selected.push(candidate);
  }
  return selected.map(({ day, index }, tickIndex) => ({
    day,
    label: monthly ? `${Number(day.slice(5, 7))}月` : day.slice(5).replace("-", "."),
    year:
      tickIndex === 0 || day.slice(0, 4) !== selected[tickIndex - 1].day.slice(0, 4)
        ? day.slice(0, 4)
        : null,
    textAnchor:
      position(index) < minGap / 2
        ? "start"
        : position(index) > width - minGap / 2
          ? "end"
          : "middle",
  }));
}

export function CompactAssetTrendDateTick(
  props: XAxisTickContentProps & { dateTicks: CalendarDateTick[] },
) {
  const dateTick = props.dateTicks.find((tick) => tick.day === String(props.payload.value));
  if (!dateTick) return null;
  const tick = AssetTrendDateTick(props);
  return (
    <text {...tick.props} textAnchor={dateTick.textAnchor}>
      <tspan x={props.x}>{dateTick.label}</tspan>
      {dateTick.year ? (
        <tspan x={props.x} dy="1.5em">
          {dateTick.year}
        </tspan>
      ) : null}
    </text>
  );
}

export function CalendarAssetTrendXAxis({ points }: { points: AssetTrendChartPoint[] }) {
  const plotArea = usePlotArea();
  const dateTicks = calendarAssetTrendTicks(
    points.map((point) => point.day),
    plotArea?.width ?? 0,
  );
  return (
    <XAxis
      axisLine={{ stroke: "var(--line-2)" }}
      dataKey="day"
      height={44}
      interval={0}
      ticks={dateTicks.map((tick) => tick.day)}
      tick={(props) => <CompactAssetTrendDateTick {...props} dateTicks={dateTicks} />}
      tickFormatter={(day) => dateTicks.find((tick) => tick.day === day)?.label ?? day}
      tickLine={{ stroke: "var(--line-2)" }}
    />
  );
}
