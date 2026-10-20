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
import { VibeSelect } from "@/ui/vibe/vibe-field";

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
  rangePresentation = "default",
  title,
  ...chart
}: Omit<ComponentProps<typeof AssetTrendChart>, "incompleteCount" | "unavailableCount"> & {
  range: AssetTrendRange;
  metricControls?: ReactNode;
  children?: ReactNode;
  emptyMessage?: string;
  rangePresentation?: "default" | "quiet" | "compact";
  title?: string;
}) {
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

  function choosePreset(preset: InvestmentPerformanceIntervalPreset) {
    if (preset !== "custom") {
      range.onChange(preset, null);
      return;
    }
    const days = rangeDays(range.preset, range.currentDay, range.firstDay, range.customRange);
    setStartDay(range.customRange?.startDay ?? days[0] ?? range.firstDay ?? range.currentDay);
    setEndDay(range.customRange?.endDay ?? days.at(-1) ?? range.currentDay);
    // The selected menu option unmounts; let the dialog restore focus to the trigger.
    if (rangePresentation === "compact") document.getElementById(`${id}-range`)?.focus();
    setEditing(true);
  }

  return <div
    className={`asset-trend-panel asset-trend-panel--${rangePresentation}`}
    aria-busy={range.pending || undefined}
  >
    {metricControls}
    {rangePresentation === "compact" ? <header className="asset-trend-panel__toolbar">
      {title ? <h2>{title}</h2> : null}
      <div className="asset-trend-panel__range" role="group" aria-label="分析区间">
        <VibeSelect
          fieldId={`${id}-range`}
          label="分析区间"
          variant="compact"
          disabled={range.pending}
          value={range.preset}
          onValueChange={choosePreset}
          options={INTERVAL_OPTIONS.map(option => ({ ...option, label: option.value === "all" ? "全部历史" : option.label }))}
        />
        {range.preset === "custom" ? <VibeButton type="button" variant="text" size="compact" disabled={range.pending} onClick={() => choosePreset("custom")}>修改日期</VibeButton> : null}
      </div>
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
      coverageNote={rangePresentation !== "default" && !chart.isSensitiveHidden
        ? actualDays.length
          ? `实际记录 ${formatShanghaiDayLabel(actualDays[0]!)} 至 ${formatShanghaiDayLabel(actualDays.at(-1)!)}`
          : "所选区间暂无实际记录"
        : undefined}
      coveragePresentation={rangePresentation === "compact" ? "disclosure" : "default"}
      emptyMessage={emptyMessage}
      incompleteCount={chart.points.filter(point => (point.observed || point.manualRecordDay) && point.status !== "complete").length}
      unavailableCount={chart.points.filter(point => (point.observed || point.manualRecordDay) && point.amount === null).length}
    />
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
