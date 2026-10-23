import {
  daysForTrendRange,
  sourceTrendObservationStatus,
  type TrendRange,
} from "@/domain/daily-trend-observations";
import {
  convertCurrencyAmount,
  type ReportingCurrency,
} from "@/domain/valuation";
import type {
  AssetTrendChartPoint,
} from "@/ui/asset-trend-chart";
import type {
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";

export type SourceTrendObservation =
  & DailyAssetTrendObservation["sources"][number]
  & { day: string };

type ManualTrendRecord = Pick<ManualAssetRecord, "day" | "currency"> & { amount: string | null };

export interface AssetSourceTrendModel {
  abnormalPoints: AssetTrendChartPoint[];
  missingDayCount: number;
  notice: string;
  points: AssetTrendChartPoint[];
  unavailablePoints: AssetTrendChartPoint[];
}

function sourceHistoryFor(
  sourceId: string,
  history: readonly DailyAssetTrendObservation[],
): SourceTrendObservation[] {
  return history.flatMap((snapshot) => {
    const item = snapshot.sources.find((source) => source.sourceId === sourceId);
    return item ? [{ day: snapshot.day, ...item }] : [];
  });
}

function latestManualRecordByDay(
  records: readonly ManualTrendRecord[],
): ManualTrendRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .toSorted((left, right) => {
      const dayComparison = left.record.day.localeCompare(right.record.day);
      // Historical data should contain one record per day. Keep the former
      // stable-sort behavior if a legacy duplicate is encountered.
      return dayComparison || right.index - left.index;
    })
    .map(({ record }) => record);
}

function latestRecordOnOrBefore(
  sortedRecords: readonly ManualTrendRecord[],
  day: string,
): ManualTrendRecord | undefined {
  let lower = 0;
  let upper = sortedRecords.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (sortedRecords[middle]!.day <= day) lower = middle + 1;
    else upper = middle;
  }
  return lower === 0 ? undefined : sortedRecords[lower - 1];
}

export function assetSourceTrendModel({
  currentDay,
  history,
  isManual,
  manualRecords,
  reportingCurrency,
  sourceId,
  trendDays,
  trendRange,
}: {
  currentDay: string;
  history: readonly DailyAssetTrendObservation[];
  isManual: boolean;
  manualRecords: readonly ManualTrendRecord[];
  reportingCurrency: ReportingCurrency;
  sourceId: string;
  trendDays?: readonly string[];
  trendRange: TrendRange;
}): AssetSourceTrendModel {
  const sourceHistory = sourceHistoryFor(sourceId, history);
  const firstSourceTrendDay = isManual
    ? manualRecords.reduce<string | undefined>(
      (earliest, record) =>
        earliest === undefined || record.day < earliest ? record.day : earliest,
      undefined,
    )
    : sourceHistory.reduce<string | undefined>(
      (earliest, observation) =>
        earliest === undefined || observation.day < earliest
          ? observation.day
          : earliest,
      undefined,
    );
  const sourceTrendDays = trendDays ?? daysForTrendRange(
    trendRange,
    currentDay,
    firstSourceTrendDay,
  );
  const sourceTrendByDay = new Map(
    sourceHistory.map((observation) => [observation.day, observation]),
  );
  const trendSnapshotByDay = new Map(
    history.map((snapshot) => [snapshot.day, snapshot]),
  );
  const sortedManualRecords = isManual
    ? latestManualRecordByDay(manualRecords)
    : [];
  const points = sourceTrendDays.map((day) => {
    if (isManual) {
      const record = latestRecordOnOrBefore(sortedManualRecords, day);
      if (record === undefined) {
        return {
          day,
          amount: null,
          observed: false,
          status: "incomplete" as const,
        };
      }
      const recordedObservation = sourceTrendByDay.get(record.day);
      const recordedSnapshot = trendSnapshotByDay.get(record.day);
      const amount = record.amount === null ? null : record.currency === reportingCurrency
        ? record.amount
        : recordedObservation?.total[reportingCurrency] ?? convertCurrencyAmount(
          record.amount,
          record.currency,
          reportingCurrency,
          recordedSnapshot?.exchangeRates ?? [],
        );
      return {
        day,
        amount,
        manualRecordDay: record.day,
        observed: record.day === day,
        status: amount === null ? "incomplete" as const : "complete" as const,
      };
    }
    const observation = sourceTrendByDay.get(day);
    return {
      day,
      amount: observation?.total[reportingCurrency] ?? null,
      observed: observation !== undefined,
      status: observation === undefined
        ? "incomplete" as const
        : sourceTrendObservationStatus(observation),
    };
  });
  const unavailablePoints = points.filter(
    (point) => point.amount === null && sourceTrendByDay.has(point.day),
  );
  const abnormalPoints = points.filter(
    (point) => point.amount !== null && point.status !== "complete",
  );
  const missingDayCount = isManual
    ? 0
    : sourceTrendDays.filter((day) => !sourceTrendByDay.has(day)).length;
  const notice = [
    isManual
      ? "手工记录"
      : missingDayCount > 0
        ? `缺少 ${missingDayCount} 天观测`
        : null,
    abnormalPoints.length > 0 || unavailablePoints.length > 0
      ? `数据受限：${
        [
          abnormalPoints.length > 0
            ? `${abnormalPoints.length} 天不完整或过期`
            : null,
          unavailablePoints.length > 0
            ? `${unavailablePoints.length} 天未估值`
            : null,
        ].filter(Boolean).join(" · ")
      }`
      : null,
  ].filter(Boolean).join(" · ");

  return {
    abnormalPoints,
    missingDayCount,
    notice,
    points,
    unavailablePoints,
  };
}
