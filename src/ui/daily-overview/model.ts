import { decimalSubtract } from "@/domain/decimal";
import {
  longbridgeReferenceRates,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import { rangeDays } from "@/domain/investment-performance-trend";
import { totalAssetTrendStatus } from "@/domain/total-asset-trend";
import {
  buildTotalValuation,
  convertCurrencyAmount,
  type ReportingCurrency,
} from "@/domain/valuation";
import type { DailyAssetTrendObservation } from "@/server/ports";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";

import type { AssetTrendRangeSelection } from "@/ui/asset-trend-panel";
import type { OverviewSource } from "./sources-model";

function latestCompletedPriorObservation(
  observations: DailyAssetTrendObservation[],
  currentDay: string,
  currency: ReportingCurrency,
): DailyAssetTrendObservation | null {
  return (
    observations
      .filter(
        (observation) =>
          observation.day < currentDay &&
          totalAssetTrendStatus(observation, currency) === "complete",
      )
      .toSorted(
        (left, right) =>
          right.day.localeCompare(left.day) || right.capturedAt.localeCompare(left.capturedAt),
      )
      .at(0) ?? null
  );
}

function daysBetweenShanghaiDays(startDay: string, endDay: string): number {
  const start = Date.parse(`${startDay}T00:00:00.000Z`);
  const end = Date.parse(`${endDay}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export function buildOverviewTotals({
  currentObservedAt,
  longbridgeRates,
  recordedSources,
  usdValuation,
  usdValuationComplete,
}: {
  currentObservedAt: string;
  longbridgeRates: ReturnType<typeof longbridgeReferenceRates>;
  recordedSources: OverviewSource[];
  usdValuation: ReturnType<typeof buildTotalValuation>;
  usdValuationComplete: boolean;
}) {
  // 比较与收益仍要求新鲜数据，不与总额估值完整性共用展示判断。
  const complete =
    usdValuationComplete &&
    usdValuation.expiredCount === 0 &&
    recordedSources.every(
      (source) => source.lifecycle !== "disconnected" && source.sync.status === "current",
    );
  return (["USD", "CNY", "HKD"] as const).reduce(
    (totals, reportingCurrency) => {
      const amount =
        usdValuation.amount === null
          ? null
          : reportingCurrency === "USD"
            ? usdValuation.amount
            : convertCurrencyAmount(usdValuation.amount, "USD", reportingCurrency, longbridgeRates);
      totals[reportingCurrency] =
        amount === null
          ? null
          : {
              amount,
              complete,
              observedAt: currentObservedAt,
            };
      return totals;
    },
    {} as Record<ReportingCurrency, PortfolioObservation | null>,
  );
}

export function compareOverviewObservations({
  currency,
  currentDay,
  current,
  totalTrendObservations,
  recordedSources,
}: {
  currency: ReportingCurrency;
  currentDay: string;
  current: PortfolioObservation | null;
  totalTrendObservations: DailyAssetTrendObservation[];
  recordedSources: OverviewSource[];
}) {
  const recordedTodayObservation =
    totalTrendObservations
      .filter(
        (observation) =>
          observation.day === currentDay &&
          totalAssetTrendStatus(observation, currency) === "complete",
      )
      .toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt))
      .at(0) ?? null;
  const recordedTodayTotal = recordedTodayObservation?.total[currency] ?? null;
  const changeEndpoint = current?.complete
    ? current
    : recordedTodayObservation !== null && recordedTodayTotal !== null
      ? {
          amount: recordedTodayTotal,
          complete: true,
          observedAt: recordedTodayObservation.capturedAt,
        }
      : null;
  const usesRecordedTodayObservation = !current?.complete && changeEndpoint !== null;
  const priorObservation = latestCompletedPriorObservation(
    totalTrendObservations,
    currentDay,
    currency,
  );
  const daysSincePriorObservation =
    priorObservation === null ? null : daysBetweenShanghaiDays(priorObservation.day, currentDay);
  const intervalFallback = daysSincePriorObservation !== null && daysSincePriorObservation > 1;
  const sourceComparisonLabel =
    priorObservation === null
      ? "前值"
      : intervalFallback
        ? formatShanghaiDayLabel(priorObservation.day)
        : "昨日";
  const comparisonTotal = priorObservation?.total[currency];
  const changeSourceIds = new Set(
    current?.complete
      ? recordedSources.map((source) => source.id)
      : recordedTodayObservation?.sources.map((source) => source.sourceId),
  );
  const hasSameSourceScope =
    priorObservation !== null &&
    changeSourceIds.size === priorObservation.sources.length &&
    priorObservation.sources.every((source) => changeSourceIds.has(source.sourceId));
  const todayChange =
    changeEndpoint !== null && hasSameSourceScope && comparisonTotal != null
      ? decimalSubtract(changeEndpoint.amount, comparisonTotal)
      : null;

  return {
    changeEndpoint,
    usesRecordedTodayObservation,
    priorObservation,
    daysSincePriorObservation,
    intervalFallback,
    sourceComparisonLabel,
    todayChange,
  };
}

export function buildOverviewTrend({
  currency,
  currentDay,
  totalTrendObservations,
  trendRange,
}: {
  currency: ReportingCurrency;
  currentDay: string;
  totalTrendObservations: DailyAssetTrendObservation[];
  trendRange: Pick<AssetTrendRangeSelection, "preset" | "customRange">;
}) {
  const firstTrendDay = totalTrendObservations
    .filter((observation) => observation.total[currency] != null)
    .map((observation) => observation.day)
    .toSorted()
    .at(0);
  const days = rangeDays(trendRange.preset, currentDay, firstTrendDay, trendRange.customRange);
  const observationsByDay = new Map(
    totalTrendObservations.map((observation) => [observation.day, observation]),
  );
  const points = days.map((day) => {
    const observation = observationsByDay.get(day);
    const status = observation ? totalAssetTrendStatus(observation, currency) : "incomplete";
    return {
      day,
      amount: observation?.total[currency] ?? null,
      observed: observation !== undefined,
      status,
    };
  });
  return {
    firstDay: firstTrendDay,
    points,
  };
}
