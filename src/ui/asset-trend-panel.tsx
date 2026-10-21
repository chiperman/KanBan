"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  rangeDays,
  type InvestmentPerformanceCustomRange,
  type InvestmentPerformanceIntervalPreset,
} from "@/domain/investment-performance-trend";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { INTERVAL_OPTIONS } from "@/ui/reporting-currency-options";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";

type CompactRangePreset = "7d" | "1m" | "6m" | "1y" | "all";

const COMPACT_RANGE_PRESETS: readonly CompactRangePreset[] = [
  "7d",
  "1m",
  "6m",
  "1y",
  "all",
];

const COMPACT_RANGE_LABELS: Record<CompactRangePreset, string> = {
  "7d": "1周",
  "1m": "1月",
  "6m": "半年",
  "1y": "1年",
  all: "全部",
};

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
  rangePresentation = "default",
  title,
  ...chart
}: Omit<ComponentProps<typeof AssetTrendChart>, "incompleteCount" | "unavailableCount" | "showDotFill"> & {
  range: AssetTrendRange;
  metricControls?: ReactNode;
  children?: ReactNode;
  emptyMessage?: string;
  rangePresentation?: "default" | "quiet" | "compact";
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
  ].flatMap(point => point.manualRecordDay
    ? [point.manualRecordDay]
    : point.observed ? [point.day] : []))].toSorted();
  const validRange = startDay !== "" && endDay !== "" &&
    startDay <= endDay && endDay <= range.currentDay;
  const rangeControl = rangePresentation === "compact" ? (
    <div className="asset-trend-panel__range asset-trend-panel__range--below" role="group" aria-label="分析区间">
      <div className="asset-trend-panel__range-options">
        {COMPACT_RANGE_PRESETS.map(preset => <VibeButton
          key={preset}
          aria-pressed={range.preset === preset}
          className="asset-trend-panel__range-option vibe-button--range"
          disabled={range.pending}
          onClick={() => choosePreset(preset)}
          size="compact"
          type="button"
          variant="text"
        >{COMPACT_RANGE_LABELS[preset]}</VibeButton>)}
      </div>
      <VibeButton
        aria-label="自定义分析区间"
        aria-haspopup="dialog"
        aria-pressed={range.preset === "custom"}
        className="asset-trend-panel__custom-range vibe-button--range"
        title="自定义分析区间"
        type="button"
        variant="text"
        size="compact"
        shape="square"
        disabled={range.pending}
        onClick={() => choosePreset("custom")}
      ><VibeIcon name="calendar" /></VibeButton>
    </div>
  ) : null;

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
    className={`asset-trend-panel asset-trend-panel--${rangePresentation}`}
    aria-busy={range.pending || undefined}
  >
    {metricControls}
    {rangePresentation === "compact" ? <header className="asset-trend-panel__toolbar">
      {title ? <h2>{title}</h2> : null}
    </header> : <div className="investment-performance__range" role="group" aria-label="分析区间">
      <span aria-hidden="true" className="vibe-field__label">分析区间</span>
      <div className="investment-performance__range-options">
        {INTERVAL_OPTIONS.map(option => <VibeButton
          key={option.value}
          aria-pressed={range.preset === option.value}
          className="investment-performance__range-option"
          disabled={range.pending}
          onClick={() => choosePreset(option.value)}
          size="compact"
          type="button"
          variant={rangePresentation === "quiet" && range.preset !== option.value ? "text" : range.preset === option.value ? "primary" : "outline"}
        >{option.label}</VibeButton>)}
      </div>
      {range.preset === "custom" && range.customRange ? <span className="investment-performance__custom-range-label">
        已选 {formatShanghaiDayLabel(range.customRange.startDay)} 至 {formatShanghaiDayLabel(range.customRange.endDay)}
      </span> : null}
    </div>}
    {rangePresentation === "compact" && range.preset === "custom" && range.customRange ? <p className="investment-performance__custom-range-label">
      {range.customRange.startDay} 至 {range.customRange.endDay}
    </p> : null}
    {children}
    <AssetTrendChart
      {...chart}
      showDotFill={showTrendDots}
      plotPresentation={rangePresentation === "compact" ? "minimal" : chart.plotPresentation}
      coverageNote={rangePresentation !== "default" && !chart.isSensitiveHidden
        ? actualDays.length
          ? `实际记录 ${formatShanghaiDayLabel(actualDays[0]!)} 至 ${formatShanghaiDayLabel(actualDays.at(-1)!)}`
          : "所选区间暂无实际记录"
        : undefined}
      coveragePresentation={coveragePresentation ?? (rangePresentation === "compact" ? "disclosure" : "default")}
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
