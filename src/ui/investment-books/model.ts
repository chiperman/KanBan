import { decimalAdd, decimalCompare, decimalMultiply } from "@/domain/decimal";
import type {
  analyzeInvestmentBook,
  createInvestmentBookIntervalAnalyzer,
} from "@/domain/investment-books";
import { rangeDays } from "@/domain/investment-performance-trend";
import type { AssetTrendEvent } from "@/ui/asset-trend-chart";
import { longbridgeOriginalFundingAmount } from "@/ui/investment-book-record-amount";

import { labels } from "./shared";

import type { AssetTrendRangeSelection } from "@/ui/asset-trend-panel";

export type BookAnalysis = ReturnType<typeof analyzeInvestmentBook>;

export function buildBookRange({
  analysis,
  currentDay,
  trendRange,
}: {
  analysis: BookAnalysis;
  currentDay: string;
  trendRange: Pick<AssetTrendRangeSelection, "preset" | "customRange">;
}) {
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
  return {
    days,
    selectedDays,
    isInterval,
    startDay,
    endDay,
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

/**
 * Before the first real valuation, cumulative book funding can provide a
 * visual capital line. It is deliberately kept out of BookAnalysis so it
 * cannot affect profit, return, summaries, or benchmark comparisons.
 */
function buildBookInferredTotals(analysis: BookAnalysis, days: readonly string[]) {
  const firstValuationDay = analysis.points.find((point) => point.total !== null)?.day;
  const rows = analysis.records
    .filter((row) => row.kind === "opening" || row.kind === "deposit" || row.kind === "withdrawal")
    .toSorted(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.id.localeCompare(b.id),
    );
  if (!rows.length || !analysis.fundingProjectionAvailable) return new Map<string, string>();

  const totals = new Map<string, string>();
  let total = "0";
  let rowIndex = 0;
  let hasFunding = false;
  const signedAmount = (row: (typeof rows)[number]) =>
    row.kind === "withdrawal" ? `-${row.amount}` : row.amount;

  for (const day of days) {
    if (firstValuationDay && day >= firstValuationDay) break;
    while (rowIndex < rows.length && rows[rowIndex].day <= day) {
      total = decimalAdd(total, signedAmount(rows[rowIndex]));
      hasFunding = true;
      rowIndex += 1;
    }
    if (hasFunding) totals.set(day, total);
  }
  return totals;
}

export function buildBookChartPoints({
  days,
  isInterval,
  startDay,
  analysis,
  analyzeInterval,
  curve,
  fundingEvents,
}: Pick<ReturnType<typeof buildBookRange>, "days" | "isInterval" | "startDay"> & {
  analysis: BookAnalysis;
  analyzeInterval: ReturnType<typeof createInvestmentBookIntervalAnalyzer>;
  curve: "return" | "total";
  fundingEvents: ReturnType<typeof buildBookFundingEvents>;
}) {
  const pointMap = new Map(analysis.points.map((row) => [row.day, row]));
  const inferredTotals = buildBookInferredTotals(analysis, days);
  const points = days.map((day) => {
    const row = pointMap.get(day);
    const inferred = curve === "total" && row?.total == null && inferredTotals.has(day);
    let amount = row?.total ?? (inferred ? inferredTotals.get(day)! : null);
    if (curve === "return") {
      const periodReturn = isInterval
        ? day === startDay &&
          row?.total != null &&
          row.netInvestment != null &&
          decimalCompare(row.total, "0") > 0
          ? "0"
          : analyzeInterval(day).returnRatio
        : (row?.returnRatio ?? null);
      amount = periodReturn === null ? null : decimalMultiply(periodReturn, "100");
    }
    return {
      day,
      amount,
      events: fundingEvents.get(day),
      inferred: inferred || undefined,
      observed: !!row && !inferred,
      status: inferred || amount == null ? ("incomplete" as const) : ("complete" as const),
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
