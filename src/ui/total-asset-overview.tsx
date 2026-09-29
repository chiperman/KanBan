"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  daysForTrendRange,
  totalTrendObservationStatus,
  type TrendRange,
} from "@/domain/daily-trend-observations";
import {
  buildTotalValuation,
  type DistributionDimension,
  type ReportingCurrency,
  type ValuationSource,
} from "@/domain/valuation";
import type {
  DailyAssetTrendObservation,
  FormalDailySettlement,
  ManualAssetRecord,
} from "@/server/ports";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { FormalDailySettlementSummary } from "@/ui/formal-daily-settlement-summary";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
} from "@/ui/shanghai-date-time";

const CURRENCY_OPTIONS: readonly VibeSelectOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

const DIMENSION_OPTIONS: readonly VibeSelectOption<DistributionDimension>[] = [
  { value: "class", label: "资产类别" },
  { value: "source", label: "资产来源" },
  { value: "currency", label: "原始币种" },
];

export const TREND_RANGE_STORAGE_KEY = "asset-trend-range";
const DAILY_DETAIL_PAGE_SIZE = 30;

export type { TrendRange } from "@/domain/daily-trend-observations";

const TREND_RANGE_OPTIONS: readonly VibeSelectOption<TrendRange>[] = [
  { value: "7d", label: "7日" },
  { value: "30d", label: "30日" },
  { value: "90d", label: "90日" },
  { value: "1y", label: "1年" },
  { value: "all", label: "全部" },
];

type TotalTrendPoint = {
  day: string;
  index: number;
  amount: string | null;
  complete: boolean;
  manualRecordDay?: string;
  observed: boolean;
  status: "complete" | "incomplete" | "expired";
};

type TrendValuationSource = ValuationSource & {
  manualRecords?: ManualAssetRecord[];
};

type YesterdaySourceChange = {
  sourceId: string;
  label: string;
  change: string;
  state: "changed" | "added" | "removed";
};

function sourceGroupTitle(source: ValuationSource): string {
  return assetSourceDisplayName(source);
}

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

function signedAmount(value: string): string {
  return `${decimalCompare(value, "0") >= 0 ? "+" : ""}${amount(value)}`;
}

function absoluteAmount(value: string): string {
  return decimalCompare(value, "0") < 0
    ? decimalSubtract("0", value)
    : value;
}

function yesterdaySourceChanges(
  today: DailyAssetTrendObservation | undefined,
  yesterday: DailyAssetTrendObservation | undefined,
  currency: ReportingCurrency,
): YesterdaySourceChange[] {
  if (!today || !yesterday) return [];

  const todayBySourceId = new Map(
    today.sources.map((source) => [source.sourceId, source]),
  );
  const yesterdayBySourceId = new Map(
    yesterday.sources.map((source) => [source.sourceId, source]),
  );
  const sourceIds = new Set([
    ...todayBySourceId.keys(),
    ...yesterdayBySourceId.keys(),
  ]);

  return [...sourceIds]
    .flatMap<YesterdaySourceChange>((sourceId): YesterdaySourceChange[] => {
      const current = todayBySourceId.get(sourceId);
      const previous = yesterdayBySourceId.get(sourceId);
      const currentAmount = current?.total[currency] ?? null;
      const previousAmount = previous?.total[currency] ?? null;
      const label = current?.label ?? previous?.label;
      if (!label) return [];

      if (currentAmount !== null && previousAmount !== null) {
        const change = decimalSubtract(currentAmount, previousAmount);
        return decimalCompare(change, "0") === 0
          ? []
          : [{
            sourceId,
            label,
            change,
            state: "changed" as const,
          }];
      }

      if (currentAmount !== null && previous === undefined) {
        return [{
          sourceId,
          label,
          change: currentAmount,
          state: "added" as const,
        }];
      }

      if (previousAmount !== null && current === undefined) {
        return [{
          sourceId,
          label,
          change: decimalSubtract("0", previousAmount),
          state: "removed" as const,
        }];
      }

      return [];
    })
    .toSorted((left, right) =>
      decimalCompare(absoluteAmount(right.change), absoluteAmount(left.change)),
    );
}

function trendStatusLabel(status: TotalTrendPoint["status"]): string {
  return status === "expired"
    ? "过期"
    : status === "incomplete"
      ? "不完整"
      : "完整";
}

export function TotalAssetOverview({
  sources,
  currency,
  onCurrencyChange,
  trendRange,
  onTrendRangeChange,
  history,
  formalDailySettlements,
  currentDay,
  persistPreferences = true,
  showSensitiveInfo,
  storageNamespace = "owner",
}: {
  sources: TrendValuationSource[];
  currency: ReportingCurrency;
  onCurrencyChange(value: ReportingCurrency): void;
  trendRange: TrendRange;
  onTrendRangeChange(value: TrendRange): void;
  history: DailyAssetTrendObservation[];
  formalDailySettlements: FormalDailySettlement[];
  currentDay: string;
  persistPreferences?: boolean;
  showSensitiveInfo: boolean;
  storageNamespace?: "demo" | "owner";
}) {
  const [dimension, setDimension] = useState<DistributionDimension>("class");
  const [detailPage, setDetailPage] = useState(1);

  useEffect(() => {
    if (!persistPreferences) return;
    const savedDimension = window.localStorage.getItem(
      `${storageNamespace}-distribution-dimension`,
    );
    if (
      savedDimension === "class" ||
      savedDimension === "source" ||
      savedDimension === "currency"
    ) {
      setDimension(savedDimension);
    }
  }, [persistPreferences, storageNamespace]);

  const valuation = useMemo(
    () => buildTotalValuation(sources, currency, dimension),
    [currency, dimension, sources],
  );
  const allocationGroups = valuation.groups.filter(
    (group) => group.amount !== null && decimalCompare(group.amount, "0") > 0,
  );
  const sourceTitleById = new Map(
    sources.map((source) => [source.id, sourceGroupTitle(source)]),
  );
  const valuationStatusText = valuation.incomplete
    ? valuation.unvaluedCount > 0
      ? `当前估值：不完整 · ${valuation.unvaluedCount} 项未估值`
      : "当前估值：不完整"
    : "当前估值：完整";
  const valuationStatus = [
    valuationStatusText,
    valuation.coverageIssues.length > 0
      ? `来源覆盖：不完整 · ${valuation.coverageIssues.length} 个来源`
      : null,
    valuation.expiredCount > 0
      ? `包含 ${valuation.expiredCount} 个过期来源`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const valuationDetailHint = valuation.aggregateOnlySourceCount > 0
    ? `产品明细：部分仅汇总 · ${valuation.aggregateOnlySourceCount} 个来源`
    : null;
  const valuationStatusTone =
    valuation.incomplete ||
    valuation.expiredCount > 0 ||
    valuation.coverageIssues.length > 0
    ? "error"
      : "success";
  const firstTrendDay = useMemo(
    () => history.reduce<string | undefined>(
      (earliest, observation) =>
        earliest === undefined || observation.day < earliest
          ? observation.day
          : earliest,
      undefined,
    ),
    [history],
  );
  const totalTrendDays = useMemo(
    () => daysForTrendRange(trendRange, currentDay, firstTrendDay),
    [currentDay, firstTrendDay, trendRange],
  );
  const observationsByDay = useMemo(
    () => new Map(history.map((observation) => [observation.day, observation])),
    [history],
  );
  const manualSources = useMemo(
    () => sources.filter(
      (source) => source.kind === "manual" && source.hasManualRecord !== false,
    ),
    [sources],
  );
  const hasAutomatedSources = sources.some((source) => source.kind !== "manual");
  const totalTrendPoints = useMemo<TotalTrendPoint[]>(
    () => totalTrendDays.map((day, index) => {
      const observation = observationsByDay.get(day);
      if (observation !== undefined) {
        const status = totalTrendObservationStatus(observation.sources);
        return {
          day,
          index,
          amount: observation.total[currency] ?? null,
          complete: status === "complete",
          observed: true,
          status,
        };
      }
      if (hasAutomatedSources || manualSources.length === 0) {
        return {
          day,
          index,
          amount: null,
          complete: false,
          observed: false,
          status: "incomplete",
        };
      }
      const manualValues = manualSources.map((source) => {
        const record = (source.manualRecords ?? [])
          .filter((item) => item.day <= day)
          .toSorted((left, right) => right.day.localeCompare(left.day))[0];
        if (record === undefined) return null;
        const recordedObservation = observationsByDay.get(record.day);
        const recordedSource = recordedObservation?.sources.find(
          (item) => item.sourceId === source.id,
        );
        const amount = recordedSource?.total[currency] ??
          (record.currency === currency ? record.amount : null);
        return amount === null ? null : { amount, recordDay: record.day };
      });
      if (manualValues.some((value) => value === null)) {
        return {
          day,
          index,
          amount: null,
          complete: false,
          observed: false,
          status: "incomplete",
        };
      }
      const values = manualValues as Array<{ amount: string; recordDay: string }>;
      return {
        day,
        index,
        amount: values.length === 0
          ? null
          : decimalAdd(...values.map((value) => value.amount)),
        complete: true,
        manualRecordDay: values.length === 1 ? values[0]?.recordDay : undefined,
        observed: false,
        status: "complete",
      };
    }),
    [
      currency,
      hasAutomatedSources,
      manualSources,
      observationsByDay,
      totalTrendDays,
    ],
  );
  const trendToday = totalTrendPoints.at(-1);
  const trendYesterday = totalTrendPoints.at(-2);
  const yesterdayChange =
    trendToday !== undefined &&
    trendYesterday !== undefined &&
    trendToday.amount !== null &&
    trendYesterday.amount !== null &&
    trendToday.status === "complete" &&
    trendYesterday.status === "complete"
      ? decimalSubtract(trendToday.amount, trendYesterday.amount)
      : null;
  const comparisonIssue = (
    point: TotalTrendPoint | undefined,
    fallback: string,
  ) => {
    if (point?.manualRecordDay) {
      return `${formatShanghaiDayLabel(point.day)}沿用 ${formatShanghaiDayLabel(point.manualRecordDay)}手工记录`;
    }
    if (!point?.observed) return `${fallback}缺少观测`;
    if (point.amount === null) return `${formatShanghaiDayLabel(point.day)}未估值`;
    if (point.status === "expired") return `${formatShanghaiDayLabel(point.day)}过期`;
    if (point.status === "incomplete") return `${formatShanghaiDayLabel(point.day)}不完整`;
    return null;
  };
  const yesterdayComparisonReason = yesterdayChange === null
    ? [
      comparisonIssue(trendToday, "今日"),
      comparisonIssue(trendYesterday, "昨日"),
    ].filter((reason): reason is string => reason !== null).join("；") ||
      "昨日缺少观测"
    : null;
  const todayObservation = trendToday?.observed
    ? observationsByDay.get(trendToday.day)
    : undefined;
  const yesterdayObservation = trendYesterday?.observed
    ? observationsByDay.get(trendYesterday.day)
    : undefined;
  const sourceChanges = useMemo(
    () => yesterdaySourceChanges(
      todayObservation,
      yesterdayObservation,
      currency,
    ),
    [currency, todayObservation, yesterdayObservation],
  );
  const validTrendPoints = totalTrendPoints.filter(
    (point) => point.amount !== null,
  );
  const completeTrendPoints = validTrendPoints.filter((point) => point.complete);
  const abnormalTrendPoints = validTrendPoints.filter(
    (point) => point.status !== "complete",
  );
  const unavailableTrendPoints = totalTrendPoints.filter(
    (point) =>
      point.amount === null &&
      observationsByDay.has(point.day),
  );
  const intervalStart = completeTrendPoints.length >= 2
    ? completeTrendPoints.at(0)
    : undefined;
  const intervalEnd = completeTrendPoints.length >= 2
    ? completeTrendPoints.at(-1)
    : undefined;
  const intervalChange =
    intervalStart?.amount && intervalEnd?.amount
      ? decimalSubtract(intervalEnd.amount, intervalStart.amount)
      : null;
  const intervalRatio =
    intervalChange !== null &&
    intervalStart?.amount !== undefined &&
    intervalStart.amount !== null &&
    decimalCompare(intervalStart.amount, "0") !== 0
      ? decimalMultiply(decimalDivide(intervalChange, intervalStart.amount), "100")
      : null;
  const dailyDetails = useMemo(
    () => [...history].sort((left, right) => right.day.localeCompare(left.day)),
    [history],
  );
  const detailPageCount = Math.max(
    1,
    Math.ceil(dailyDetails.length / DAILY_DETAIL_PAGE_SIZE),
  );
  const detailRows = dailyDetails.slice(
    (detailPage - 1) * DAILY_DETAIL_PAGE_SIZE,
    detailPage * DAILY_DETAIL_PAGE_SIZE,
  );
  function changeCurrency(value: ReportingCurrency) {
    onCurrencyChange(value);
  }

  function changeDimension(value: DistributionDimension) {
    setDimension(value);
    if (persistPreferences) {
      window.localStorage.setItem(
        `${storageNamespace}-distribution-dimension`,
        value,
      );
    }
  }

  function changeTrendRange(value: TrendRange) {
    onTrendRangeChange(value);
    setDetailPage(1);
  }

  useEffect(() => {
    setDetailPage(1);
  }, [currency, trendRange]);

  return (
    <section
      className="total-overview vibe-data-module"
      data-testid="total-asset-overview"
      data-vibe-module="asset-overview"
    >
      <div className="total-overview-head">
        <div>
          <p className="card-label">总资产概览</p>
          <VibeMetric
            className="total-overview-amount"
            data-testid="total-asset-amount"
            unit={valuation.currency}
            value={valuation.amount === null
              ? "无法折算"
              : showSensitiveInfo
                ? amount(valuation.amount)
                : "••••••"}
          />
          <div className="total-statuses" aria-label="估值状态">
            <VibeStatusTag
              className={`total-status${valuation.incomplete ? " incomplete" : ""}${valuation.expiredCount > 0 ? " expired" : ""}`}
              tone={valuationStatusTone}
            >
              {valuationStatus}
            </VibeStatusTag>
            {valuationDetailHint ? (
              <VibeStatusTag
                className="total-status-hint"
                data-testid="valuation-detail-hint"
                tone="warning"
              >
                {valuationDetailHint}
              </VibeStatusTag>
            ) : null}
          </div>
          <div className="allocation-instrument" aria-label="分配比例仪表">
            <div className="allocation-instrument-head">
              <span>ALLOCATION / {dimension.toUpperCase()}</span>
              <span>{String(allocationGroups.length).padStart(2, "0")} GROUPS</span>
            </div>
            <VibeSegmentedBar
              ariaLabel={`${dimension} 维度资产分配，共 ${allocationGroups.length} 组`}
              segments={allocationGroups.map((group) => ({
                key: group.key,
                value: Number(group.amount),
              }))}
            />
          </div>
        </div>
        <div className="valuation-controls">
          <VibeSelect
            fieldId="reporting-currency"
            label="计价货币"
            value={currency}
            options={CURRENCY_OPTIONS}
            variant="compact"
            onValueChange={changeCurrency}
          />
          <VibeSelect
            fieldId="distribution-dimension"
            label="分布维度"
            value={dimension}
            options={DIMENSION_OPTIONS}
            variant="wide"
            onValueChange={changeDimension}
          />
        </div>
      </div>
      {valuation.exchangeRateObservations.length > 0 ? (
        <p className="conversion-observation">
          {valuation.exchangeRateObservations.map((observation, index) => (
            <span key={`${observation.baseCurrency}/${observation.quoteCurrency}`}>
              {index > 0 ? "；" : "汇率观察："}
              {observation.baseCurrency}/{observation.quoteCurrency}{" "}
              {decimalToFixed(observation.rate, 4)} · {observation.source} ·{" "}
              {formatShanghaiDateTime(observation.observedAt)}
            </span>
          ))}
        </p>
      ) : null}
      {valuation.coverageIssues.length > 0 ? (
        <VibeNotice
          className="valuation-reconciliation-notice valuation-coverage-notice"
          data-testid="valuation-coverage-notice"
          role="status"
          tone="info"
        >
          <p>
            {valuation.coverageIssues.map((issue) => issue.sourceLabel).join("、")}
            ：产品覆盖不完整。
          </p>
        </VibeNotice>
      ) : null}
      {valuation.reconciliationIssues.length > 0 ? (
        <VibeNotice
          className="valuation-reconciliation-notice"
          data-testid="valuation-reconciliation-notice"
          role="status"
          tone="info"
        >
          {valuation.reconciliationIssues.map((issue) => {
            if (issue.kind === "quote-unavailable") {
              return (
                <p key={issue.sourceId}>
                  {`${issue.sourceLabel}：${issue.quoteUnavailableCount} 项期权缺少行情；总资产以账户总额为准。`}
                </p>
              );
            }
            const prefix = issue.unvaluedCount > 0
              ? `${issue.unvaluedCount} 项持仓未估值，`
              : "";
            return (
              <p key={issue.sourceId}>
                {issue.sourceLabel}：{showSensitiveInfo && issue.amount !== null
                  ? `${prefix}持仓与账户总额相差 ${amount(issue.amount)} ${valuation.currency}。`
                  : `${prefix}持仓与账户总额未对齐。`}
                总资产以账户总额为准。
              </p>
            );
          })}
        </VibeNotice>
      ) : null}
      {trendToday?.observed && trendToday.status === "complete" ? (
        <section
          className="today-asset-change"
          data-testid="total-asset-yesterday-change"
        >
          <p className="card-label">
            较昨日{trendYesterday ? ` · ${formatShanghaiDayLabel(trendYesterday.day)}` : ""}
          </p>
          {yesterdayChange === null ? (
            <p className="trend-empty">{yesterdayComparisonReason}</p>
          ) : (
            <>
              <p className="today-change-amount">
                {showSensitiveInfo ? signedAmount(yesterdayChange) : "••••••"}{" "}
                <span className="amount-unit">{currency}</span>
              </p>
              <p className="trend-empty">
                {showSensitiveInfo
                  ? `昨日总资产 ${amount(trendYesterday?.amount ?? "0")}`
                  : "昨日总资产 ••••••"}{" "}
                {currency}
              </p>
              {sourceChanges.length > 0 ? (
                <div
                  className="today-change-sources"
                  data-testid="total-asset-yesterday-source-changes"
                >
                  <p>变动来源</p>
                  <ul>
                    {sourceChanges.map((source) => (
                      <li key={source.sourceId}>
                        <span>
                          {source.label}
                          {source.state === "added"
                            ? " · 新纳入"
                            : source.state === "removed"
                              ? " · 已移除"
                              : ""}
                        </span>
                        <strong>
                          {showSensitiveInfo
                            ? signedAmount(source.change)
                            : "••••••"}{" "}
                          {currency}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      <div className="distribution-list" aria-label="资产分布">
        {valuation.groups.map((group, index) => (
          <div key={group.key} className="distribution-item vibe-data-row">
            <span className="distribution-name">
              <span className="distribution-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              {dimension === "source"
                ? (sourceTitleById.get(group.key) ?? group.label)
                : group.label}
            </span>
            <strong>
              {group.amount === null
                ? "未折算"
                : showSensitiveInfo
                  ? amount(group.amount)
                  : "••••••"}{" "}
              {valuation.currency}
            </strong>
          </div>
        ))}
      </div>
      <section className="asset-trend" data-testid="total-asset-trend">
        <div className="asset-trend-heading">
          <p className="card-label">总资产趋势</p>
          <VibeSelect
            fieldId="trend-range"
            label="趋势区间"
            value={trendRange}
            options={TREND_RANGE_OPTIONS}
            variant="compact"
            onValueChange={changeTrendRange}
          />
        </div>
        {!showSensitiveInfo ? (
          <AssetTrendChart
            ariaLabel="总资产趋势已隐藏"
            currency={currency}
            formatAmount={amount}
            formatDay={formatShanghaiDayLabel}
            incompleteCount={0}
            isSensitiveHidden
            points={[]}
            unavailableCount={0}
          />
        ) : history.length === 0 ? (
          <p className="trend-empty">等待首次同步</p>
        ) : (
          <>
            <AssetTrendChart
              ariaLabel={trendRange === "all"
                ? "全部总资产趋势"
                : `最近${totalTrendDays.length}个上海自然日总资产趋势`}
              currency={currency}
              formatAmount={amount}
              formatDay={formatShanghaiDayLabel}
              incompleteCount={abnormalTrendPoints.length}
              lineType={hasAutomatedSources ? "linear" : "stepAfter"}
              points={totalTrendPoints}
              unavailableCount={unavailableTrendPoints.length}
            />
            {intervalStart && intervalEnd && intervalChange !== null ? (
              <div className="trend-interval-change">
                <p className="trend-interval-label">区间资产变动</p>
                <>
                  <p>
                    {formatShanghaiDayLabel(intervalStart.day)} 至{" "}
                    {formatShanghaiDayLabel(intervalEnd.day)}
                  </p>
                  <strong>
                    {signedAmount(intervalChange)} {currency}
                  </strong>
                  <p>
                    资产变化比例{" "}
                    {intervalRatio === null
                      ? "无法计算"
                      : `${decimalToFixed(intervalRatio, 2)}%`}
                  </p>
                </>
              </div>
            ) : null}
            <details className="daily-trend-details">
              <summary>观测明细（{dailyDetails.length}）</summary>
              <div className="daily-trend-details-content">
                <ol className="daily-trend-detail-list">
                  {detailRows.map((observation) => {
                    const observationStatus = observation.status ??
                      (observation.complete ? "complete" : "incomplete");
                    const observationAmount = observation.total[currency] ?? null;
                    const abnormal =
                      observationStatus !== "complete" ||
                      observationAmount === null;
                    return (
                      <li key={observation.day} data-testid="daily-trend-detail">
                        <time dateTime={observation.day}>
                          {formatShanghaiDayLabel(observation.day)}
                        </time>
                        <strong>
                          {observationAmount === null
                            ? "未估值"
                            : `${amount(observationAmount)} ${currency}`}
                        </strong>
                        {abnormal ? (
                          <span>
                            {observationAmount === null
                              ? `未估值 · ${trendStatusLabel(observationStatus)}`
                              : trendStatusLabel(observationStatus)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {detailPageCount > 1 ? (
                  <nav className="daily-trend-pagination" aria-label="每日明细分页">
                    <VibeButton
                      type="button"
                      aria-label="上一页每日明细"
                      disabled={detailPage === 1}
                      onClick={() => setDetailPage((page) =>
                        Math.max(1, page - 1),
                      )}
                      variant="outline"
                    >
                      上一页
                    </VibeButton>
                    <span aria-live="polite">
                      第 {detailPage} / {detailPageCount} 页
                    </span>
                    <VibeButton
                      type="button"
                      aria-label="下一页每日明细"
                      disabled={detailPage === detailPageCount}
                      onClick={() => setDetailPage((page) =>
                        Math.min(detailPageCount, page + 1),
                      )}
                      variant="outline"
                    >
                      下一页
                    </VibeButton>
                  </nav>
                ) : null}
              </div>
            </details>
          </>
        )}
      </section>
      <FormalDailySettlementSummary
        settlements={formalDailySettlements}
        currency={currency}
        showSensitiveInfo={showSensitiveInfo}
      />
    </section>
  );
}
