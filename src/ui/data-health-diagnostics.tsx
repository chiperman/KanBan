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
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeSelect } from "@/ui/vibe/vibe-field";

export type DataHealthSource = Omit<
  AssetSourceSummary,
  "credentialReference"
>;

type TimeRange = Extract<TrendRange, "7d" | "30d" | "all">;
type SourceFilter = "all" | string;
type OverviewFilter = "all" | "attention" | "healthy";
type CompletenessFilter = "all" | "complete" | "incomplete";
type HistoryState = "complete" | "incomplete" | "gap";

type HistoryEntry = {
  day: string;
  detail: string;
  state: HistoryState;
};

type DiagnosticSource = {
  manualWithoutRecord: boolean;
  name: string;
  reasons: string[];
  source: DataHealthSource;
  valuation: ReturnType<typeof valuationSummary>;
};

type SharedDiagnostic = {
  reason: string;
  sources: DiagnosticSource[];
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

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
} {
  if (!hasManualAssetRecord(source)) {
    return {
      label: "尚无估值",
      reasons: ["尚未添加首条手工记录"],
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
    return { label: "估值不完整 · 未估值", reasons };
  }
  if (valuation.incomplete) {
    return {
      label: "估值不完整",
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
    };
  }
  if (coverage?.status === "partial") {
    return {
      label: "总额估值完整 · 持仓明细不全",
      reasons: ["持仓明细覆盖不足", ...coverageReasons],
    };
  }
  if (coverage?.status === "unknown") {
    return {
      label: "总额估值完整 · 覆盖待确认",
      reasons: ["尚未确认来源总额覆盖", ...coverageReasons],
    };
  }
  return { label: "估值完整", reasons: [] };
}

function syncLabels(source: DataHealthSource): string[] {
  if (source.kind === "manual") {
    return hasManualAssetRecord(source) ? ["手工记录"] : ["等待首条记录"];
  }
  const labels = source.sync.error === null ? [] : ["同步失败"];
  if (source.sync.status === "expired") labels.push("数据过期");
  if (labels.length === 0) labels.push("数据当前");
  return labels;
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
): string[] {
  return [
    ...(source.sync.error === null ? [] : [`上次同步失败：${source.sync.error}`]),
    ...valuation.reasons,
  ];
}

function sourceStateTone(source: DataHealthSource): "current" | "issue" {
  return source.sync.error === null && source.sync.status === "current"
    ? "current"
    : "issue";
}

function sourceDetailAction({
  manualWithoutRecord,
  source,
  valuation,
}: DiagnosticSource): string {
  if (manualWithoutRecord) return "添加记录";
  if (source.sync.error !== null) return "排查同步";
  if (valuation.label !== "估值完整") return "排查估值";
  return "查看详情";
}

function overviewHeading(
  filter: OverviewFilter,
  attentionSourceCount: number,
): string {
  if (filter === "attention") {
    return attentionSourceCount > 0 ? "需关注来源" : "来源状态";
  }
  if (filter === "healthy") return "正常来源";
  return "全部来源";
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
  const [range, setRange] = useState<TimeRange>("all");
  const [sourceId, setSourceId] = useState<SourceFilter>("all");
  const [completeness, setCompleteness] =
    useState<CompletenessFilter>("all");
  const [overviewFilter, setOverviewFilter] =
    useState<OverviewFilter>("attention");
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const sourceOptions = [
    { value: "all", label: "全部来源" },
    ...sources.map((source) => ({
      value: source.id,
      label: assetSourceDisplayName(source),
    })),
  ];
  const entries = useMemo(
    () => historyEntries(history, currentDay, range, selectedSource),
    [currentDay, history, range, selectedSource],
  );
  const filteredEntries = entries.filter((entry) =>
    completeness === "all"
      ? true
      : completeness === "complete"
        ? entry.state === "complete"
        : entry.state !== "complete",
  );
  const incompleteCount = entries.filter(
    (entry) => entry.state === "incomplete",
  ).length;
  const gapCount = entries.filter((entry) => entry.state === "gap").length;
  const diagnosticSources = useMemo<DiagnosticSource[]>(
    () =>
      sources
        .map((source) => {
          const valuation = valuationSummary(source, sources);
          const reasons = sourceDiagnosticReasons(source, valuation);
          return {
            manualWithoutRecord:
              source.kind === "manual" && !hasManualAssetRecord(source),
            name: assetSourceDisplayName(source),
            reasons,
            source,
            valuation,
          };
        })
        .sort(
          (left, right) =>
            Number(right.reasons.length > 0) -
            Number(left.reasons.length > 0),
        ),
    [sources],
  );
  const attentionSourceCount = diagnosticSources.filter(
    ({ reasons }) => reasons.length > 0,
  ).length;
  const healthySourceCount = sources.length - attentionSourceCount;
  const activeOverviewFilter =
    attentionSourceCount === 0 && overviewFilter === "attention"
      ? "all"
      : overviewFilter;
  const sharedDiagnostics = useMemo<SharedDiagnostic[]>(() => {
    const sourcesByReason = new Map<string, DiagnosticSource[]>();
    for (const diagnosticSource of diagnosticSources) {
      if (diagnosticSource.reasons.length === 0) continue;
      for (const reason of diagnosticSource.reasons) {
        const matchedSources = sourcesByReason.get(reason) ?? [];
        matchedSources.push(diagnosticSource);
        sourcesByReason.set(reason, matchedSources);
      }
    }
    return Array.from(sourcesByReason, ([reason, matchedSources]) => ({
      reason,
      sources: matchedSources,
    })).filter(({ sources: matchedSources }) => matchedSources.length > 1);
  }, [diagnosticSources]);
  const sharedDiagnosticReasons = new Set(
    sharedDiagnostics.map(({ reason }) => reason),
  );
  const visibleDiagnosticSources = diagnosticSources.filter(
    ({ reasons }) =>
      activeOverviewFilter === "all" ||
      (activeOverviewFilter === "attention" && reasons.length > 0) ||
      (activeOverviewFilter === "healthy" && reasons.length === 0),
  );
  const historyCoverageEntries = entries.slice(-30);

  return (
    <div className="data-health-diagnostics" data-testid="data-health-diagnostics">
      <section className="data-health-intro">
        <p className="data-health-intro__eyebrow">READ ONLY / DIAGNOSTICS</p>
        <p className="data-health-intro__summary">
          先确认哪些来源影响当前资产视图，再进入来源详情排查。
        </p>
        <p className="data-health-intro__boundary">
          刷新、重新授权与来源生命周期操作保留在对应来源详情。
        </p>
      </section>

      <section aria-label="来源诊断" className="data-health-source-section">
        <div className="data-health-section-heading">
          <div>
            <p className="card-label">SOURCE HEALTH / CURRENT STATE</p>
            <h2>{overviewHeading(activeOverviewFilter, attentionSourceCount)}</h2>
          </div>
          <div
            aria-label={`共 ${sources.length} 个来源，${healthySourceCount} 个正常，${attentionSourceCount} 个需关注`}
            className="data-health-summary"
            role="group"
          >
            {[
              {
                count: sources.length,
                filter: "all" as const,
                label: "来源总数",
                actionLabel: "全部",
                tone: "muted",
              },
              {
                count: healthySourceCount,
                filter: "healthy" as const,
                label: "正常",
                actionLabel: "正常",
                tone: "current",
              },
              {
                count: attentionSourceCount,
                filter: "attention" as const,
                label: "需关注",
                actionLabel: "需关注",
                tone: attentionSourceCount > 0 ? "issue" : "muted",
              },
            ].map(({ actionLabel, count, filter, label, tone }) => (
              <button
                aria-label={`显示${actionLabel}来源（${count} 个）`}
                aria-pressed={activeOverviewFilter === filter}
                className="data-health-summary__item"
                key={filter}
                onClick={() => setOverviewFilter(filter)}
                type="button"
              >
                <span>{label}</span>
                <strong data-tone={tone}>
                  {count}<small>个</small>
                </strong>
              </button>
            ))}
          </div>
        </div>
        {sources.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">暂无可诊断来源</p>
            <p className="empty-hint">接入或创建来源后，此处会显示同步与历史覆盖状态。</p>
          </div>
        ) : (
          <>
            {activeOverviewFilter !== "healthy" && sharedDiagnostics.length > 0 ? (
              <ul
                aria-label="共同诊断"
                className="data-health-shared-diagnostics"
              >
                {sharedDiagnostics.map(({ reason, sources: matchedSources }) => {
                  const hasUnvaluedSource = matchedSources.some(({ valuation }) =>
                    valuation.label.includes("未估值")
                  );
                  return (
                    <li key={reason}>
                      <p>共同诊断 · 影响 {matchedSources.length} 个来源</p>
                      <strong>{reason}</strong>
                      <span>
                        {hasUnvaluedSource
                          ? "相关未估值资产未计入总览："
                          : "请在对应来源详情排查："}
                        {matchedSources.map(({ name, source }) => (
                          <VibeLink
                            aria-label={`查看 ${name} 来源详情`}
                            href={`/asset-sources/${encodeURIComponent(source.id)}`}
                            key={source.id}
                            variant="text"
                          >
                            {name}
                          </VibeLink>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div aria-hidden="true" className="data-health-source__columns">
              <span>来源</span>
              <span>同步状态</span>
              <span>最近更新</span>
              <span>估值完整性</span>
              <span>详情</span>
            </div>
            <ol
              aria-live="polite"
              className="data-health-source-list"
            >
              {visibleDiagnosticSources.map(
                ({
                  manualWithoutRecord,
                  name,
                  reasons,
                  source,
                  valuation,
                }) => {
                  const requiresAttention = reasons.length > 0;
                  const visibleReasons = reasons.filter(
                    (reason) => !sharedDiagnosticReasons.has(reason),
                  );
                  const action = sourceDetailAction({
                    manualWithoutRecord,
                    name,
                    reasons,
                    source,
                    valuation,
                  });
                  return (
                    <li
                      data-testid={`data-health-source-${source.id}`}
                      key={source.id}
                    >
                      <article
                        className={`data-health-source${requiresAttention ? " data-health-source--issue" : " data-health-source--compact"}`}
                      >
                        <div className="data-health-source__identity">
                          <h3>{name}</h3>
                          <p>{source.label}</p>
                        </div>
                        <div className="data-health-source__fact">
                          <span>同步状态</span>
                          <p data-tone={sourceStateTone(source)}>
                            {syncLabels(source).join(" · ")}
                          </p>
                        </div>
                        <div className="data-health-source__fact">
                          <span>{source.kind === "manual" ? "最近记录" : "最后成功"}</span>
                          <p>
                            {manualWithoutRecord
                              ? "尚无记录"
                              : formatTime(source.sync.lastSuccessfulAt)}
                          </p>
                        </div>
                        <div className="data-health-source__fact">
                          <span>估值完整性</span>
                          <p
                            data-tone={
                              valuation.label === "估值完整" ? "current" : "issue"
                            }
                          >
                            {valuation.label}
                          </p>
                        </div>
                        <VibeLink
                          aria-label={`${action} ${name} 来源详情`}
                          href={`/asset-sources/${encodeURIComponent(source.id)}`}
                          variant="text"
                        >
                          {action}
                        </VibeLink>
                        {visibleReasons.length > 0 ? (
                          <ul
                            aria-label={`${name} 诊断原因`}
                            className="data-health-source__reasons"
                          >
                            {visibleReasons.map((reason) => <li key={reason}>{reason}</li>)}
                          </ul>
                        ) : null}
                      </article>
                    </li>
                  );
                },
              )}
            </ol>
          </>
        )}
      </section>

      <section aria-label="历史观测" className="data-health-history" data-testid="data-health-history">
        <div className="data-health-section-heading">
          <div>
            <p className="card-label">HISTORY / COVERAGE</p>
            <h2>历史覆盖</h2>
          </div>
          <p>
            {incompleteCount > 0 || gapCount > 0
              ? `不完整历史 ${incompleteCount} 天 · 数据缺口 ${gapCount} 天`
              : "所选范围内观测完整"}
          </p>
        </div>
        <ol
          aria-label={`所选范围的历史覆盖，共 ${historyCoverageEntries.length} 天`}
          className="data-health-history__coverage"
        >
          {historyCoverageEntries.map((entry) => (
            <li data-state={entry.state} key={entry.day}>
              <time
                aria-label={`${entry.day} · ${historyStatusLabel(entry.state)} · ${entry.detail}`}
                dateTime={entry.day}
              >
                {entry.day.slice(5).replace("-", "/")}
              </time>
            </li>
          ))}
        </ol>
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
            onValueChange={(value) =>
              setCompleteness(value as CompletenessFilter)
            }
            options={COMPLETENESS_OPTIONS}
            value={completeness}
            variant="wide"
          />
        </div>
        {filteredEntries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">所选条件没有匹配观测</p>
            <p className="empty-hint">改变完整性筛选可查看完整、未估值、过期或缺失的历史状态。</p>
          </div>
        ) : (
          <ol className="data-health-history__list">
            {filteredEntries.map((entry) => (
              <li data-state={entry.state} key={entry.day}>
                <p>{entry.day} · {historyStatusLabel(entry.state)}</p>
                <span>{entry.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
