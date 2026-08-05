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
  exchangeRates: AssetSourceSummary["snapshot"]["exchangeRates"],
): string | null {
  const valuation = buildTotalValuation([{
    ...source,
    snapshot: {
      ...source.snapshot,
      exchangeRates,
    },
  }], currency, "source");
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
  exchangeRates: AssetSourceSummary["snapshot"]["exchangeRates"],
): DailyAssetSourceSnapshot {
  const sourceWithSharedRates = {
    ...source,
    snapshot: {
      ...source.snapshot,
      exchangeRates,
    },
  };
  const total = {
    USD: sourceValue(source, "USD", exchangeRates),
    CNY: sourceValue(source, "CNY", exchangeRates),
    HKD: sourceValue(source, "HKD", exchangeRates),
  };
  const valuation = buildTotalValuation(
    [sourceWithSharedRates],
    "USD",
    "source",
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
    sourceSnapshot(source, capturedAt, exchangeRates),
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
  preserveObservationCapturedAt: boolean,
): DailyAssetTrendObservation {
  const sourceIdsUnchanged =
    previous.sources.length === next.sources.length &&
    previous.sources.every((source) =>
      next.sources.some(({ sourceId }) => sourceId === source.sourceId),
    );
  if (previous.complete && !next.complete && sourceIdsUnchanged) {
    return previous;
  }
  const bySourceId = new Map(
    previous.sources.map((source) => [source.sourceId, source]),
  );
  for (const source of next.sources) {
    const previousSource = bySourceId.get(source.sourceId);
    bySourceId.set(
      source.sourceId,
      preserveObservationCapturedAt && previousSource
        ? { ...source, capturedAt: previousSource.capturedAt }
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
  return {
    ...next,
    capturedAt: preserveObservationCapturedAt
      ? previous.capturedAt
      : next.capturedAt,
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
