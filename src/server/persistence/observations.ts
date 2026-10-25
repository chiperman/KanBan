import { sourceTrendClassTotals } from "@/domain/daily-asset-snapshots";
import { convertCurrencyAmount } from "@/domain/valuation";
import type { AssetExchangeRate, AssetSourceSummary, DailyAssetSourceSnapshot, ManualAssetRecord } from "@/server/ports";

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
