import { decimalAdd, decimalCompare, decimalMultiply } from "@/domain/decimal";
import {
  analyzeInvestmentBook,
  analyzeInvestmentBookInterval,
  type InvestmentBookId,
  type InvestmentBookState,
} from "@/domain/investment-books";
import { rangeDays } from "@/domain/investment-performance-trend";
import type { AssetTrendEvent } from "@/ui/asset-trend-chart";
import { longbridgeOriginalFundingAmount } from "@/ui/investment-book-record-amount";

import { labels } from "./shared";

import type { AssetTrendRangeSelection } from "@/ui/asset-trend-panel";

export type BookAnalysis = ReturnType<typeof analyzeInvestmentBook>;

export function buildBookRange({
  analysis,
  state,
  bookId,
  currentDay,
  trendRange,
}: {
  analysis: BookAnalysis;
  state: InvestmentBookState;
  bookId: InvestmentBookId;
  currentDay: string;
  trendRange: Pick<AssetTrendRangeSelection, "preset" | "customRange">;
}) {
  const current = analysis.summary;
  const firstValuationDay = analysis.points.find((point) => point.total !== null)?.day;
  const pointMap = new Map(analysis.points.map((row) => [row.day, row]));
  const days = rangeDays(
    trendRange.preset,
    currentDay,
    analysis.firstTrendDay ?? undefined,
    trendRange.customRange,
  );
  const selectedDays = new Set(days);
  const isInterval = trendRange.preset !== "all";
  const startDay = days[0] ?? currentDay;
  const endDay = days.at(-1) ?? currentDay;
  const interval = analyzeInvestmentBookInterval({
    points: analysis.points,
    state,
    bookId,
    startDay,
    endDay,
  });

  return {
    current,
    firstValuationDay,
    pointMap,
    days,
    selectedDays,
    isInterval,
    startDay,
    endDay,
    interval,
  };
}

export function buildBookFundingEvents(analysis: BookAnalysis) {
  const fundingEvents = new Map<string, AssetTrendEvent[]>();
  for (const record of analysis.records) {
    if (record.kind === "valuation") continue;
    const events = fundingEvents.get(record.day) ?? [];
    const originalAmount = longbridgeOriginalFundingAmount(record);
    events.push({
      amount: record.amount,
      currency: record.currency,
      kind: record.kind,
      ...(originalAmount ? { originalAmount } : {}),
    });
    fundingEvents.set(record.day, events);
  }

  return fundingEvents;
}

export function buildBookChartPoints({
  days,
  pointMap,
  isInterval,
  startDay,
  analysis,
  state,
  bookId,
  curve,
  fundingEvents,
}: ReturnType<typeof buildBookRange> & {
  analysis: BookAnalysis;
  state: InvestmentBookState;
  bookId: InvestmentBookId;
  curve: "return" | "total";
  fundingEvents: ReturnType<typeof buildBookFundingEvents>;
}) {
  const points = days.map((day) => {
    const row = pointMap.get(day);
    const periodReturn = isInterval
      ? day === startDay &&
        row?.total != null &&
        row.netInvestment != null &&
        decimalCompare(row.total, "0") > 0
        ? "0"
        : analyzeInvestmentBookInterval({
            points: analysis.points,
            state,
            bookId,
            startDay,
            endDay: day,
          }).returnRatio
      : (row?.returnRatio ?? null);
    const amount =
      curve === "total"
        ? (row?.total ?? null)
        : periodReturn === null
          ? null
          : decimalMultiply(periodReturn, "100");
    return {
      day,
      amount,
      events: fundingEvents.get(day),
      observed: !!row,
      status: amount == null ? ("incomplete" as const) : ("complete" as const),
    };
  });

  return points;
}

export function buildBookDepositTotals(analysis: BookAnalysis, unassignedLegacyCount: number) {
  const totals = new Map<string, string | null>();
  let total = unassignedLegacyCount > 0 ? null : (analysis.opening?.amount ?? null);
  const funds = analysis.records
    .filter((row) => row.kind === "deposit" || row.kind === "withdrawal")
    .toSorted(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.id.localeCompare(b.id),
    );
  for (const row of funds) {
    if (row.currency !== analysis.book.currency) total = null;
    else if (total !== null)
      total = decimalAdd(total, row.kind === "withdrawal" ? `-${row.amount}` : row.amount);
    if (row.kind === "deposit")
      totals.set(row.id, analysis.opening && row.day >= analysis.opening.day ? total : null);
  }
  return totals;
}

export function buildBookTimeline(analysis: BookAnalysis) {
  const timeline = [
    ...analysis.points.map((point) => ({
      key: `asset:${point.day}`,
      day: point.day,
      label: "资产金额",
      kind: "valuation" as const,
      amount: point.total,
      basis: point.basis,
      record: analysis.records.find((row) => row.kind === "valuation" && row.day === point.day),
    })),
    ...analysis.records
      .filter((row) => row.kind !== "valuation")
      .map((row) => ({
        key: row.id,
        day: row.day,
        label: labels[row.kind],
        kind: row.kind,
        amount: row.amount,
        basis:
          row.origin === "statement"
            ? row.currency === analysis.book.currency
              ? "长桥结单"
              : "长桥结单，待补当日汇率"
            : row.origin === "import"
              ? "导入历史"
              : row.origin === "legacy"
                ? "旧资金原件"
                : "手动记录",
        record: row,
      })),
  ].toSorted((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));

  return timeline;
}
