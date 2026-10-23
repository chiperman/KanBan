"use client";

import { useMemo, useState } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  daysForTrendRange,
  sourceTrendObservationStatus,
  type TrendRange,
} from "@/domain/daily-trend-observations";
import {
  activeSourceHoldings,
} from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import {
  buildTotalValuation,
  holdingMakesTotalIncomplete,
} from "@/domain/valuation";
import type {
  AssetSourceSummary,
  DailyAssetTrendObservation,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeSelect } from "@/ui/vibe/vibe-field";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";

export type DataHealthSource = Omit<
  AssetSourceSummary,
  "credentialReference"
>;

type TimeRange = Extract<TrendRange, "7d" | "30d" | "all">;
type SourceFilter = "all" | string;
type CompletenessFilter = "all" | "complete" | "incomplete";
type HistoryState = "complete" | "incomplete" | "gap";

type HistoryEntry = {
  day: string;
  detail: string;
  state: HistoryState;
};

export type DiagnosticSource = {
  manualWithoutRecord: boolean;
  name: string;
  reasons: { label: string; tone: "error" | "warning" | "muted" | "success" }[];
  source: DataHealthSource;
  valuation: ReturnType<typeof valuationSummary>;
};

const TIME_RANGE_OPTIONS = [
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "all", label: "全部已有观测" },
] as const;

const COMPLETENESS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "complete", label: "仅完整" },
  { value: "incomplete", label: "仅不完整" },
] as const;

function historyStatusLabel(state: HistoryState): string {
  if (state === "complete") return "完整";
  if (state === "gap") return "数据缺口";
  return "不完整历史";
}

function unvaluedReasons(source: DataHealthSource): string[] {
  return [
    ...new Set(
      activeSourceHoldings(source)
        .filter(holdingMakesTotalIncomplete)
        .flatMap((holding) =>
          holding.valuation.status === "unvalued"
            ? [holding.valuation.reason]
            : [],
        ),
    ),
  ];
}

function valuationSummary(
  source: DataHealthSource,
  rateSources: DataHealthSource[],
): {
  label: string;
  reasons: string[];
  tone: "error" | "warning" | "muted" | "success";
} {
  if (!hasManualAssetRecord(source)) {
    return {
      label: "尚无估值",
      reasons: ["尚未添加首条手工记录"],
      tone: "muted",
    };
  }

  const reasons = unvaluedReasons(source);
  const valuation = buildTotalValuation(
    [source],
    "USD",
    "source",
    rateSources,
  );
  const coverage = source.snapshot.coverage;
  const coverageReasons = coverage?.products.flatMap(({ message }) =>
    message ? [message] : []
  ) ?? [];

  if (reasons.length > 0) {
    return { label: "估值不完整 · 未估值", reasons, tone: "error" };
  }
  if (valuation.incomplete) {
    return {
      label: "估值不完整",
      tone: coverage?.status === "unknown" ? "warning" : "error",
      reasons: [
        coverage?.status === "partial"
          ? "来源覆盖不完整"
          : coverage?.status === "unknown"
            ? "尚未确认来源总额覆盖"
            : "缺少可靠估值或折算依据",
        ...coverageReasons,
      ],
    };
  }
  if (source.sync.status === "expired") {
    return {
      label: "估值基于过期数据",
      reasons: ["最后成功数据已过期", ...coverageReasons],
      tone: "warning",
    };
  }
  if (coverage?.status === "partial") {
    return {
      label: "总额估值完整 · 持仓明细不全",
      reasons: ["持仓明细覆盖不足", ...coverageReasons],
      tone: "warning",
    };
  }
  if (coverage?.status === "unknown") {
    return {
      label: "总额估值完整 · 覆盖待确认",
      reasons: ["尚未确认来源总额覆盖", ...coverageReasons],
      tone: "warning",
    };
  }
  return { label: "估值完整", reasons: [], tone: "success" };
}

function observationDetail(
  observation: DailyAssetTrendObservation,
  selectedSource: DataHealthSource | null,
): Pick<HistoryEntry, "detail" | "state"> {
  if (selectedSource === null) {
    const state = sourceTrendObservationStatus(observation);
    if (state === "complete") {
      return { state: "complete", detail: "所有已纳入来源均有完整观测" };
    }
    return {
      state: "incomplete",
      detail: state === "expired"
        ? "观测包含过期数据"
        : "观测包含未估值或不完整来源",
    };
  }

  const sourceSnapshot = observation.sources.find(
    (item) => item.sourceId === selectedSource.id,
  );
  if (sourceSnapshot === undefined) {
    return {
      state: "gap",
      detail: `没有 ${assetSourceDisplayName(selectedSource)} 观测`,
    };
  }

  const state = sourceTrendObservationStatus(sourceSnapshot);
  if (state === "complete") {
    return { state, detail: "来源观测完整" };
  }
  if (unvaluedReasons(selectedSource).length > 0) {
    return { state: "incomplete", detail: "未估值来源观测" };
  }
  if (state === "expired") {
    return { state: "incomplete", detail: "来源观测包含过期数据" };
  }
  return { state: "incomplete", detail: "来源观测不完整" };
}

function selectedDays(
  history: DailyAssetTrendObservation[],
  currentDay: string,
  range: TimeRange,
): string[] {
  if (range === "all") {
    const firstDay = history
      .map((observation) => observation.day)
      .sort()[0];
    return firstDay === undefined
      ? []
      : daysForTrendRange(range, currentDay, firstDay);
  }
  return daysForTrendRange(range, currentDay);
}

function historyEntries(
  history: DailyAssetTrendObservation[],
  currentDay: string,
  range: TimeRange,
  source: DataHealthSource | null,
): HistoryEntry[] {
  const byDay = new Map(history.map((observation) => [observation.day, observation]));
  return selectedDays(history, currentDay, range).map((day) => {
    const observation = byDay.get(day);
    if (observation === undefined) {
      return {
        day,
        state: "gap",
        detail: source === null
          ? "没有每日趋势观测"
          : `没有 ${assetSourceDisplayName(source)} 观测`,
      };
    }
    return {
      day,
      ...observationDetail(observation, source),
    };
  });
}

function sourceDiagnosticReasons(
  source: DataHealthSource,
  valuation: ReturnType<typeof valuationSummary>,
): DiagnosticSource["reasons"] {
  return [
    ...(source.sync.error === null ? [] : [{ label: `上次同步失败：${source.sync.error}`, tone: "error" as const }]),
    ...valuation.reasons.map(label => ({ label, tone: valuation.tone })),
  ];
}

export function diagnoseSources(sources: DataHealthSource[]): DiagnosticSource[] {
  return sources.map((source) => {
    const valuation = valuationSummary(source, sources);
    return {
      manualWithoutRecord: source.kind === "manual" && !hasManualAssetRecord(source),
      name: assetSourceDisplayName(source),
      reasons: sourceDiagnosticReasons(source, valuation),
      source,
      valuation,
    };
  }).sort((left, right) =>
    Number(right.reasons.length > 0) - Number(left.reasons.length > 0),
  );
}

export function DataHealthDiagnostics({
  currentDay,
  history,
  sources,
}: {
  currentDay: string;
  history: DailyAssetTrendObservation[];
  sources: DataHealthSource[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [range, setRange] = useState<TimeRange>("30d");
  const [sourceId, setSourceId] = useState<SourceFilter>("all");
  const [completeness, setCompleteness] = useState<CompletenessFilter>("incomplete");
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const sourceOptions = [
    { value: "all", label: "全部来源" },
    ...sources.map((source) => ({ value: source.id, label: assetSourceDisplayName(source) })),
  ];
  const entries = useMemo(
    () => historyEntries(history, currentDay, range, selectedSource),
    [currentDay, history, range, selectedSource],
  );
  const filteredEntries = entries.filter((entry) =>
    completeness === "all" || (completeness === "complete"
      ? entry.state === "complete"
      : entry.state !== "complete"),
  );
  const incompleteCount = entries.filter((entry) => entry.state === "incomplete").length;
  const pagination = useTablePagination(filteredEntries, JSON.stringify([range, sourceId, completeness]));
  const gapCount = entries.filter((entry) => entry.state === "gap").length;
  const rangeLabel = TIME_RANGE_OPTIONS.find((option) => option.value === range)?.label;

  return (
    <section
      aria-label="历史观测"
      className="data-health-history"
      data-testid="data-health-history"
      id="history-coverage"
    >
      <div className="data-health-section-heading">
        <div>
          <h3>历史覆盖</h3>
          <p className="data-health-history__summary">
            {rangeLabel} · {incompleteCount > 0 || gapCount > 0
              ? `不完整历史 ${incompleteCount} 天 · 数据缺口 ${gapCount} 天`
              : "观测完整"}
          </p>
        </div>
        <VibeButton
          aria-controls="history-coverage-details"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          type="button"
          variant="outline"
        >
          {expanded ? "收起历史覆盖" : "查看历史覆盖"}
        </VibeButton>
      </div>
      {expanded ? (
        <div id="history-coverage-details">
          <p className="data-health-history__hint">
            数据缺口表示当天没有观测，不代表当前同步失败。
          </p>
          <div className="data-health-filters">
            <VibeSelect
              fieldId="data-health-range"
              label="时间范围"
              onValueChange={(value) => setRange(value as TimeRange)}
              options={TIME_RANGE_OPTIONS}
              value={range}
              variant="wide"
            />
            <VibeSelect
              fieldId="data-health-source"
              label="来源"
              onValueChange={setSourceId}
              options={sourceOptions}
              value={sourceId}
              variant="wide"
            />
            <VibeSelect
              fieldId="data-health-completeness"
              label="完整性"
              onValueChange={(value) => setCompleteness(value as CompletenessFilter)}
              options={COMPLETENESS_OPTIONS}
              value={completeness}
              variant="wide"
            />
          </div>
          {filteredEntries.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">{completeness === "incomplete"
                ? "无数据缺口或不完整记录"
                : "无匹配记录"}</p>
            </div>
          ) : (
            <ol className="data-health-history__list">
              {pagination.visibleItems.map((entry) => (
                <li data-state={entry.state} key={entry.day}>
                  <p>{entry.day} · {historyStatusLabel(entry.state)}</p>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ol>
          )}
          <VibeTablePagination label="历史覆盖分页" pagination={pagination.controls} />
        </div>
      ) : null}
    </section>
  );
}
