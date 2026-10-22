import { decimalSubtract } from "@/domain/decimal";
import { assetClassTrendObservation } from "@/domain/daily-asset-snapshots";
import type { PortfolioObservation } from "@/domain/investment-performance";
import type { ReportingCurrency } from "@/domain/valuation";
import type {
  AssetTrendClass,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
} from "@/server/ports";

export type InvestmentPerformanceIntervalPreset =
  | "7d"
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
    observedAt: string | null;
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

export function rangeDays(
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
  const start = preset === "7d"
    ? dayAtOffset(currentDay, -6)
    : preset === "month-to-date"
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

function sourceObservation(
  observation: DailyAssetTrendObservation,
  sourceId: string,
): TrendValueObservation | null {
  return observation.sources.find((source) => source.sourceId === sourceId) ?? null;
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
        observedAt: null,
        status: "incomplete" as const,
      };
    }
    const scoped = scopedObservation(observation, input.assetScope);
    if (scoped === null) {
      return {
        amount: null,
        day,
        observed: false,
        observedAt: null,
        status: "incomplete" as const,
      };
    }
    return {
      amount: scoped.total[input.currency] ?? null,
      day,
      observed: true,
      observedAt: scoped.capturedAt,
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

/**
 * 把单一资产来源的每日实际观测投影成连续上海自然日序列。
 * 缺少来源观测、不完整、过期或未估值的日期不会补成可比较的端点。
 */
export function projectAssetSourceTrend(input: {
  currency: ReportingCurrency;
  customRange?: InvestmentPerformanceCustomRange | null;
  currentDay: string;
  preset: InvestmentPerformanceIntervalPreset;
  sourceId: string;
  trendObservations: DailyAssetTrendObservation[];
}): InvestmentPerformanceTrendProjection {
  return projectAssetSourceHistoryTrend({
    ...input,
    importedSourceHistoryObservations: [],
  });
}

/**
 * 投影单一来源的实际历史。长桥已结束日采用官方逐日资产，其余系统观测覆盖同日外部补录值；
 * 补录数据始终局限在该来源历史，绝不进入组合或分类投影。
 */
export function projectAssetSourceHistoryTrend(input: {
  currency: ReportingCurrency;
  customRange?: InvestmentPerformanceCustomRange | null;
  currentDay: string;
  importedSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
  preset: InvestmentPerformanceIntervalPreset;
  sourceId: string;
  trendObservations: DailyAssetTrendObservation[];
}): InvestmentPerformanceTrendProjection {
  const byDay = new Map<string, TrendValueObservation>(
    input.importedSourceHistoryObservations
      .filter((observation) => observation.sourceId === input.sourceId)
      .map((observation) => [observation.day, observation]),
  );
  for (const observation of input.trendObservations) {
    const source = sourceObservation(observation, input.sourceId);
    if (source !== null) byDay.set(observation.day, source);
  }
  for (const observation of input.importedSourceHistoryObservations) {
    if (observation.sourceId === input.sourceId && observation.kind === "longbridge" && observation.day < input.currentDay) {
      byDay.set(observation.day, observation);
    }
  }
  const firstTrendDay = [...byDay.keys()].toSorted()[0];
  const days = rangeDays(
    input.preset,
    input.currentDay,
    firstTrendDay,
    input.customRange,
  );
  const points = days.map((day) => {
    const observation = byDay.get(day);
    if (observation === undefined) {
      return {
        amount: null,
        day,
        observed: false,
        observedAt: null,
        status: "incomplete" as const,
      };
    }
    return {
      amount: observation.total[input.currency] ?? null,
      day,
      observed: true,
      observedAt: observation.capturedAt,
      status: observationStatus(observation),
    };
  });
  const complete = days.flatMap((day) => {
    const observation = byDay.get(day);
    if (observation === undefined) return [];
    const value = completeObservation(observation, input.currency);
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
