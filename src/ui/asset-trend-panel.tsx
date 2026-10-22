"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  rangeDays,
  type InvestmentPerformanceCustomRange,
  type InvestmentPerformanceIntervalPreset,
} from "@/domain/investment-performance-trend";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";

const RANGE_OPTIONS = [
  { value: "7d", label: "1周" },
  { value: "1m", label: "1月" },
  { value: "6m", label: "半年" },
  { value: "1y", label: "1年" },
  { value: "all", label: "全部" },
] as const;

export type AssetTrendRangeSelection = {
  preset: InvestmentPerformanceIntervalPreset;
  customRange: InvestmentPerformanceCustomRange | null;
  onChange(
    preset: InvestmentPerformanceIntervalPreset,
    customRange: InvestmentPerformanceCustomRange | null,
  ): void;
};

export type AssetTrendRange = AssetTrendRangeSelection & {
  currentDay: string;
  firstDay?: string;
  pending?: boolean;
};

export function useAssetTrendRange(): AssetTrendRangeSelection {
  const [selection, setSelection] = useState<{
    preset: InvestmentPerformanceIntervalPreset;
    customRange: InvestmentPerformanceCustomRange | null;
  }>({ preset: "all", customRange: null });
  return {
    ...selection,
    onChange: (preset, customRange) => setSelection({ preset, customRange }),
  };
}

export function AssetTrendPanel({
  range,
  metricControls,
  children,
  emptyMessage,
  coveragePresentation,
  title,
  ...chart
}: Omit<ComponentProps<typeof AssetTrendChart>, "incompleteCount" | "unavailableCount" | "showDotFill"> & {
  range: AssetTrendRange;
  metricControls?: ReactNode;
  children?: ReactNode;
  emptyMessage?: string;
  title?: string;
}) {
  const { showTrendDots } = useWorkbenchDisplayPreferences();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [startDay, setStartDay] = useState(range.currentDay);
  const [endDay, setEndDay] = useState(range.currentDay);
  const actualDays = [...new Set([
    ...chart.points,
    ...(chart.historicalSeries?.points ?? []),
  ].flatMap(point => point.events?.length
    ? [point.day]
    : point.manualRecordDay
    ? [point.manualRecordDay]
    : point.observed ? [point.day] : []))].toSorted();
  const validRange = startDay !== "" && endDay !== "" &&
    startDay <= endDay && endDay <= range.currentDay;
  const rangeControl = (
    <div className="asset-trend-panel__range" role="group" aria-label="分析区间">
      <div className="asset-trend-panel__range-options">
        {RANGE_OPTIONS.map(option => <VibeButton
          key={option.value}
          aria-pressed={range.preset === option.value}
          className="asset-trend-panel__range-option vibe-button--range"
          disabled={range.pending}
          onClick={() => choosePreset(option.value)}
          size="compact"
          type="button"
          variant="text"
        >{option.label}</VibeButton>)}
      </div>
      <VibeButton
        aria-label="自定义分析区间"
        aria-haspopup="dialog"
        aria-pressed={range.preset === "custom"}
        className="asset-trend-panel__custom-range vibe-button--range"
        disabled={range.pending}
        onClick={() => choosePreset("custom")}
        title="自定义分析区间"
        type="button"
        variant="text"
        size="compact"
        shape="square"
      ><VibeIcon name="calendar" /></VibeButton>
    </div>
  );

  function choosePreset(preset: InvestmentPerformanceIntervalPreset) {
    if (preset !== "custom") {
      range.onChange(preset, null);
      return;
    }
    const days = rangeDays(range.preset, range.currentDay, range.firstDay, range.customRange);
    setStartDay(range.customRange?.startDay ?? days[0] ?? range.firstDay ?? range.currentDay);
    setEndDay(range.customRange?.endDay ?? days.at(-1) ?? range.currentDay);
    setEditing(true);
  }

  return <div
    className="asset-trend-panel"
    aria-busy={range.pending || undefined}
  >
    {metricControls}
    {title ? <header className="asset-trend-panel__toolbar">
      {title ? <h2>{title}</h2> : null}
    </header> : null}
    {range.preset === "custom" && range.customRange ? <p className="investment-performance__custom-range-label">
      {range.customRange.startDay} 至 {range.customRange.endDay}
    </p> : null}
    {children}
    <AssetTrendChart
      {...chart}
      showDotFill={showTrendDots}
      coverageNote={!chart.isSensitiveHidden
        ? actualDays.length
          ? `实际记录 ${formatShanghaiDayLabel(actualDays[0]!)} 至 ${formatShanghaiDayLabel(actualDays.at(-1)!)}`
          : "所选区间暂无实际记录"
        : undefined}
      coveragePresentation={coveragePresentation ?? "disclosure"}
      emptyMessage={emptyMessage}
      incompleteCount={chart.points.filter(point => (point.observed || point.manualRecordDay) && point.status !== "complete").length}
      unavailableCount={chart.points.filter(point => (point.observed || point.manualRecordDay) && point.amount === null).length}
    />
    {rangeControl}
    {editing ? <VibeDialog
      aria-label="自定义分析区间"
      title="自定义分析区间"
      titleId={`${id}-title`}
      description="选择上海自然日区间；缺少记录的日期保留为空，不补造历史数据。"
      onClose={() => setEditing(false)}
      onSubmit={event => {
        event.preventDefault();
        if (!validRange || range.pending) return;
        range.onChange("custom", { startDay, endDay });
        setEditing(false);
      }}
      actions={<>
        <VibeButton type="button" variant="text" onClick={() => setEditing(false)}>取消</VibeButton>
        <VibeButton type="submit" variant="primary" disabled={!validRange || range.pending}>应用区间</VibeButton>
      </>}
    >
      <div className="investment-performance__custom-range-fields">
        <VibeDateField fieldId={`${id}-start`} label="开始日期" max={endDay} value={startDay} onValueChange={setStartDay} />
        <VibeDateField fieldId={`${id}-end`} label="结束日期" min={startDay} max={range.currentDay} value={endDay} onValueChange={setEndDay} />
      </div>
    </VibeDialog> : null}
  </div>;
}
