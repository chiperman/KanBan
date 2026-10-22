import { sourceTrendClassTotals } from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";
import type { AssetExchangeRate, AssetSourceSummary, DailyAssetSnapshot, DailyAssetSourceSnapshot, DailyAssetTrendObservation, ManualAssetRecord } from "@/server/ports";

export function withoutSnapshotSource(
  snapshot: DailyAssetSnapshot,
  sourceId: string,
): DailyAssetSnapshot | null {
  const sources = snapshot.sources.filter((source) => source.sourceId !== sourceId);
  if (sources.length === 0) return null;
  const total = {
    USD: sources.some((source) => source.total.USD !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.USD ?? []))
      : null,
    CNY: sources.some((source) => source.total.CNY !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.CNY ?? []))
      : null,
    HKD: sources.some((source) => source.total.HKD !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.HKD ?? []))
      : null,
  };
  return {
    ...snapshot,
    sources,
    total,
    complete:
      sources.every((source) => source.complete) &&
      total.USD !== null &&
      total.HKD !== null,
  };
}

export function manualDailySource(
  source: Pick<
    AssetSourceSummary,
    "id" | "kind" | "label" | "manualAssetClass"
  >,
  record: ManualAssetRecord,
  exchangeRates: AssetExchangeRate[] = [],
): DailyAssetSourceSnapshot {
  const total = {
    USD: convertCurrencyAmount(record.amount, record.currency, "USD", exchangeRates),
    CNY: convertCurrencyAmount(record.amount, record.currency, "CNY", exchangeRates),
    HKD: convertCurrencyAmount(record.amount, record.currency, "HKD", exchangeRates),
  };
  const observation = {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt: record.recordedAt,
    complete: true,
    status: "complete",
    total,
  } satisfies DailyAssetSourceSnapshot;
  return {
    ...observation,
    assetClassTotals: sourceTrendClassTotals(source, observation),
  };
}

export function latestManualAssetRecord(
  records: ManualAssetRecord[],
): ManualAssetRecord | null {
  return records.toSorted((left, right) => right.day.localeCompare(left.day))[0] ?? null;
}

export function applyLatestManualAssetRecord(
  source: AssetSourceSummary,
  record: ManualAssetRecord | null,
  changedAt: string,
): AssetSourceSummary {
  return {
    ...source,
    hasManualRecord: record !== null,
    snapshot: {
      ...source.snapshot,
      total: record === null
        ? { amount: "0", currency: "CNY" }
        : { amount: record.amount, currency: record.currency },
      syncedAt: record?.recordedAt ?? changedAt,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: record?.recordedAt ?? changedAt,
      lastAttemptAt: changedAt,
      error: null,
      failedMode: null,
    },
  };
}

export function mergeManualSourceObservation(
  previous: DailyAssetSnapshot,
  source: DailyAssetSourceSnapshot,
): DailyAssetSnapshot {
  const sources = [
    ...previous.sources.filter((item) => item.sourceId !== source.sourceId),
    source,
  ];
  const total = {
    USD: sources.some((item) => item.total.USD !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.USD ?? []))
      : null,
    CNY: sources.some((item) => item.total.CNY !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.CNY ?? []))
      : null,
    HKD: sources.some((item) => item.total.HKD !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.HKD ?? []))
      : null,
  };
  const complete =
    total.USD !== null &&
    total.HKD !== null &&
    sources.every((item) => item.complete);
  return {
    ...previous,
    sources,
    total,
    complete,
    status: sources.some((item) => item.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
  };
}

export function manualOnlyTrendObservation(
  day: string,
  source: DailyAssetSourceSnapshot,
): DailyAssetTrendObservation {
  return {
    day,
    capturedAt: source.capturedAt,
    exchangeRates: [],
    complete: false,
    status: "incomplete",
    total: source.total,
    sources: [source],
  };
}
