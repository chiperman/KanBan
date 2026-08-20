import { decimalAdd, decimalCompare } from "@/domain/decimal";
import { activeSourceHoldings } from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import {
  buildTotalValuation,
  holdingMakesTotalIncomplete,
  type ReportingCurrency,
} from "@/domain/valuation";
import type {
  AssetSourceSummary,
  DailyAssetSnapshot,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
} from "@/server/ports";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export function shanghaiDay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function sourceValue(
  source: AssetSourceSummary,
  currency: ReportingCurrency,
  rateSources: AssetSourceSummary[],
): string | null {
  const valuation = buildTotalValuation(
    [source],
    currency,
    "source",
    rateSources,
  );
  const hasKnownValue = valuation.groups.some(
    (group) => group.key === source.id && group.amount !== null,
  );
  const activeHoldings = activeSourceHoldings(source);
  const onlyUnknownHoldings =
    activeHoldings.length > 0 &&
    activeHoldings.every(
      holdingMakesTotalIncomplete,
    ) &&
    decimalCompare(source.snapshot.total.amount, "0") === 0;
  return hasKnownValue && !onlyUnknownHoldings ? valuation.amount : null;
}

function sourceSnapshot(
  source: AssetSourceSummary,
  capturedAt: string,
  rateSources: AssetSourceSummary[],
): DailyAssetSourceSnapshot {
  const total = {
    USD: sourceValue(source, "USD", rateSources),
    CNY: sourceValue(source, "CNY", rateSources),
    HKD: sourceValue(source, "HKD", rateSources),
  };
  const valuation = buildTotalValuation(
    [source],
    "USD",
    "source",
    rateSources,
  );
  const complete =
    source.sync.status === "current" &&
    !valuation.incomplete &&
    total.USD !== null &&
    total.HKD !== null;
  return {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt: source.sync.status === "expired"
      ? source.snapshot.syncedAt
      : capturedAt,
    complete,
    status: source.sync.status === "expired"
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
    total,
  };
}

function totalValue(
  sources: AssetSourceSummary[],
  currency: ReportingCurrency,
): string | null {
  const valuation = buildTotalValuation(sources, currency, "source");
  const hasKnownValue = valuation.groups.some(
    (group) => group.amount !== null,
  );
  return hasKnownValue ? valuation.amount : null;
}

export function buildDailyAssetSnapshot(
  sources: AssetSourceSummary[],
  capturedAt: string,
): DailyAssetSnapshot {
  const recordedSources = sources.filter(hasManualAssetRecord);
  const exchangeRates = recordedSources.flatMap(
    (source) => source.snapshot.exchangeRates,
  );
  const sourceSnapshots = recordedSources.map((source) =>
    sourceSnapshot(source, capturedAt, recordedSources),
  );
  const total = {
    USD: totalValue(recordedSources, "USD"),
    CNY: totalValue(recordedSources, "CNY"),
    HKD: totalValue(recordedSources, "HKD"),
  };
  const complete =
    sourceSnapshots.length > 0 &&
    sourceSnapshots.every((source) => source.complete) &&
    total.USD !== null &&
    total.HKD !== null;
  return {
    day: shanghaiDay(capturedAt),
    capturedAt,
    exchangeRates,
    complete,
    status: sourceSnapshots.some((source) => source.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
    total,
    sources: sourceSnapshots,
  };
}

export function mergeDailyTrendObservation(
  previous: DailyAssetTrendObservation,
  next: DailyAssetTrendObservation,
  preservePreviousOnFailedRefresh: boolean,
): DailyAssetTrendObservation {
  const bySourceId = new Map(
    previous.sources.map((source) => [source.sourceId, source]),
  );
  for (const source of next.sources) {
    const previousSource = bySourceId.get(source.sourceId);
    bySourceId.set(
      source.sourceId,
      preservePreviousOnFailedRefresh && previousSource !== undefined
        ? {
            ...source,
            capturedAt: previousSource.capturedAt,
            total: previousSource.total,
          }
        : previousSource?.complete && !source.complete
          ? previousSource
        : source,
    );
  }
  const sources = [...bySourceId.values()];
  const sum = (currency: "USD" | "CNY" | "HKD") => {
    const values = sources.flatMap((source) => source.total[currency] ?? []);
    return values.length > 0 ? decimalAdd(...values) : null;
  };
  const total = { USD: sum("USD"), CNY: sum("CNY"), HKD: sum("HKD") };
  const complete =
    total.USD !== null &&
    total.HKD !== null &&
    sources.every((source) => source.complete);
  const capturedAt = sources.reduce(
    (latest, source) =>
      source.capturedAt > latest ? source.capturedAt : latest,
    "",
  ) || next.capturedAt;
  return {
    ...next,
    capturedAt,
    sources,
    total,
    complete,
    status: sources.some((source) => source.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
  };
}
