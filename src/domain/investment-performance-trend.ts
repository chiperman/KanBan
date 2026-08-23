import { decimalSubtract } from "@/domain/decimal";
import { assetClassTrendObservation } from "@/domain/daily-asset-snapshots";
import type { PortfolioObservation } from "@/domain/investment-performance";
import type { ReportingCurrency } from "@/domain/valuation";
import type {
  AssetTrendClass,
  DailyAssetTrendObservation,
} from "@/server/ports";

export type InvestmentPerformanceIntervalPreset =
  | "month-to-date"
  | "1m"
  | "6m"
  | "year-to-date"
  | "1y"
  | "all"
  | "custom";

export type InvestmentPerformanceCustomRange = {
  endDay: string;
  startDay: string;
};

export type InvestmentPerformanceAssetScope = "portfolio" | AssetTrendClass;
export type InvestmentPerformanceTrendStatus =
  | "complete"
  | "incomplete"
  | "expired";

export interface InvestmentPerformanceTrendProjection {
  days: string[];
  end: PortfolioObservation | null;
  endDay: string | null;
  incompleteCount: number;
  intervalAssetChange: string | null;
  missingCount: number;
  points: Array<{
    amount: string | null;
    day: string;
    observed: boolean;
    status: InvestmentPerformanceTrendStatus;
  }>;
  start: PortfolioObservation | null;
  startDay: string | null;
  unavailableCount: number;
}

type TrendValueObservation = Pick<
  DailyAssetTrendObservation,
  "capturedAt" | "complete" | "status" | "total"
>;

function dayAtOffset(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + offset));
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const days: string[] = [];
  for (let day = start; day <= end; day = dayAtOffset(day, 1)) {
    days.push(day);
  }
  return days;
}

function dayAtMonthOffset(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + offset, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const lastDate = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(targetYear, targetMonthIndex, Math.min(date, lastDate)),
  ).toISOString().slice(0, 10);
}

function rangeDays(
  preset: InvestmentPerformanceIntervalPreset,
  currentDay: string,
  firstTrendDay: string | undefined,
  customRange?: InvestmentPerformanceCustomRange | null,
): string[] {
  if (preset === "custom") {
    return customRange !== undefined &&
        customRange !== null &&
        customRange.startDay <= customRange.endDay &&
        customRange.endDay <= currentDay
      ? daysBetween(customRange.startDay, customRange.endDay)
      : [];
  }
  if (preset === "all") {
    return firstTrendDay === undefined ? [] : daysBetween(firstTrendDay, currentDay);
  }
  const start = preset === "month-to-date"
    ? `${currentDay.slice(0, 7)}-01`
    : preset === "year-to-date"
      ? `${currentDay.slice(0, 4)}-01-01`
      : dayAtMonthOffset(
          currentDay,
          preset === "1m" ? -1 : preset === "6m" ? -6 : -12,
        );
  return daysBetween(start, currentDay);
}

function observationStatus(
  observation: Pick<TrendValueObservation, "complete" | "status">,
): InvestmentPerformanceTrendStatus {
  return observation.status ?? (observation.complete ? "complete" : "incomplete");
}

function completeObservation(
  observation: TrendValueObservation,
  currency: ReportingCurrency,
): PortfolioObservation | null {
  const amount = observation.total[currency] ?? null;
  return observationStatus(observation) === "complete" && amount !== null
    ? {
        amount,
        complete: true,
        observedAt: observation.capturedAt,
      }
    : null;
}

function scopedObservation(
  observation: DailyAssetTrendObservation,
  assetScope: InvestmentPerformanceAssetScope,
): TrendValueObservation | null {
  if (assetScope === "portfolio") return observation;
  const assetClassObservation = assetClassTrendObservation(observation, assetScope);
  return assetClassObservation === null
    ? null
    : {
        ...assetClassObservation,
        capturedAt: observation.capturedAt,
      };
}

/**
 * 把每日趋势观测投影成收益分析页面所需的连续上海自然日序列。
 * 资金账本和投资盈亏不属于此投影；分类范围只提供资产端点与资产变动。
 */
export function projectInvestmentPerformanceTrend(input: {
  assetScope: InvestmentPerformanceAssetScope;
  currency: ReportingCurrency;
  customRange?: InvestmentPerformanceCustomRange | null;
  currentDay: string;
  preset: InvestmentPerformanceIntervalPreset;
  trendObservations: DailyAssetTrendObservation[];
}): InvestmentPerformanceTrendProjection {
  const firstTrendDay = input.trendObservations
    .map((observation) => observation.day)
    .toSorted()[0];
  const days = rangeDays(
    input.preset,
    input.currentDay,
    firstTrendDay,
    input.customRange,
  );
  const byDay = new Map(input.trendObservations.map((observation) => [
    observation.day,
    observation,
  ]));
  const points = days.map((day) => {
    const observation = byDay.get(day);
    if (!observation) {
      return {
        amount: null,
        day,
        observed: false,
        status: "incomplete" as const,
      };
    }
    const scoped = scopedObservation(observation, input.assetScope);
    if (scoped === null) {
      return {
        amount: null,
        day,
        observed: false,
        status: "incomplete" as const,
      };
    }
    return {
      amount: scoped.total[input.currency] ?? null,
      day,
      observed: true,
      status: observationStatus(scoped),
    };
  });
  const complete = days.flatMap((day) => {
    const observation = byDay.get(day);
    if (!observation) return [];
    const scoped = scopedObservation(observation, input.assetScope);
    if (scoped === null) return [];
    const value = completeObservation(scoped, input.currency);
    return value === null ? [] : [{ day, value }];
  });
  const start = complete[0]?.value ?? null;
  const end = complete.at(-1)?.value ?? null;

  return {
    days,
    end,
    endDay: complete.at(-1)?.day ?? null,
    incompleteCount: points.filter(
      (point) => point.observed && point.status !== "complete",
    ).length,
    intervalAssetChange: start !== null && end !== null
      ? decimalSubtract(end.amount, start.amount)
      : null,
    missingCount: points.filter((point) => !point.observed).length,
    points,
    start,
    startDay: complete[0]?.day ?? null,
    unavailableCount: points.filter(
      (point) => point.observed && point.amount === null,
    ).length,
  };
}
