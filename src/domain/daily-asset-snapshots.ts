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
  AssetTrendClass,
  DailyAssetClassTotal,
  DailyAssetSnapshot,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
} from "@/server/ports";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const ASSET_TREND_CLASSES: readonly AssetTrendClass[] = [
  "securities",
  "crypto",
];

type SourceTrendClass = AssetTrendClass | "outside" | null;
// 历史观测保留原始类型文本，不冒充已校验的当前来源。
type SourceTrendIdentity = Pick<DailyAssetSourceSnapshot, "kind"> &
  Pick<AssetSourceSummary, "manualAssetClass">;

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

export function sourceTrendClass(
  source: SourceTrendIdentity,
): SourceTrendClass {
  if (source.kind === "longbridge") return "securities";
  if (
    source.kind === "binance" ||
    source.kind === "bit" ||
    source.kind === "bitget" ||
    source.kind === "okx" ||
    source.kind.startsWith("evm-watch-")
  ) {
    return "crypto";
  }
  if (source.kind !== "manual") return null;
  if (
    source.manualAssetClass === "securities" ||
    source.manualAssetClass === "crypto"
  ) {
    return source.manualAssetClass;
  }
  return source.manualAssetClass === "cash" || source.manualAssetClass === "other"
    ? "outside"
    : null;
}

export function sourceTrendClassTotals(
  source: SourceTrendIdentity,
  observation: Pick<
    DailyAssetSourceSnapshot,
    "complete" | "status" | "total"
  >,
): Record<AssetTrendClass, DailyAssetClassTotal> {
  const trendClass = sourceTrendClass(source);
  const status = observation.status ?? (
    observation.complete ? "complete" : "incomplete"
  );
  const zero = (): DailyAssetClassTotal => ({
    complete: true,
    status: "complete",
    total: { USD: "0", CNY: "0", HKD: "0" },
  });
  const unavailable = (): DailyAssetClassTotal => ({
    complete: false,
    status: "incomplete",
    total: { USD: null, CNY: null, HKD: null },
  });
  return Object.fromEntries(
    ASSET_TREND_CLASSES.map((assetClass) => [
      assetClass,
      trendClass === null
        ? unavailable()
        : trendClass === assetClass
          ? {
              complete: observation.complete,
              status,
              total: {
                USD: observation.total.USD,
                CNY: observation.total.CNY,
                HKD: observation.total.HKD ?? null,
              },
            }
          : zero(),
    ]),
  ) as Record<AssetTrendClass, DailyAssetClassTotal>;
}

function sourceSnapshot(
  source: AssetSourceSummary,
  capturedAt: string,
  rateSources: AssetSourceSummary[],
  successfulSourceIds?: ReadonlySet<string>,
): DailyAssetSourceSnapshot {
  const observed = source.kind === "manual" || (
    shanghaiDay(source.snapshot.syncedAt) === shanghaiDay(capturedAt) &&
    (successfulSourceIds === undefined || successfulSourceIds.has(source.id))
  );
  const total = {
    USD: observed ? sourceValue(source, "USD", rateSources) : null,
    CNY: observed ? sourceValue(source, "CNY", rateSources) : null,
    HKD: observed ? sourceValue(source, "HKD", rateSources) : null,
  };
  const valuation = buildTotalValuation(
    [source],
    "USD",
    "source",
    rateSources,
  );
  const complete =
    observed &&
    !valuation.incomplete &&
    total.USD !== null &&
    total.HKD !== null;
  // 历史观测的有效性不随后续同步失败而撤销；实时同步状态另行展示。
  const status = complete
      ? "complete" as const
      : "incomplete" as const;
  const snapshot = {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt: source.snapshot.syncedAt,
    complete,
    status,
    total,
  };
  return {
    ...snapshot,
    assetClassTotals: sourceTrendClassTotals(source, snapshot),
  };
}

export function buildDailyAssetSnapshot(
  sources: AssetSourceSummary[],
  capturedAt: string,
  successfulSourceIds?: ReadonlySet<string>,
): DailyAssetSnapshot {
  const recordedSources = sources.filter((source) =>
    source.lifecycle !== "disconnected" && hasManualAssetRecord(source),
  );
  const exchangeRates = recordedSources.flatMap(
    (source) => source.snapshot.exchangeRates,
  );
  const sourceSnapshots = recordedSources.map((source) =>
    sourceSnapshot(source, capturedAt, recordedSources, successfulSourceIds),
  );
  const sum = (currency: ReportingCurrency) => {
    const values = sourceSnapshots.flatMap((source) => source.total[currency] ?? []);
    return values.length > 0 ? decimalAdd(...values) : null;
  };
  const total = {
    USD: sum("USD"),
    CNY: sum("CNY"),
    HKD: sum("HKD"),
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
    sourceScope: recordedSources.map(source => source.id),
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

export function assetClassTrendObservation(
  observation: DailyAssetTrendObservation,
  assetClass: AssetTrendClass,
): DailyAssetClassTotal | null {
  if (observation.sources.length === 0) return null;
  const classTotals = observation.sources.map(
    (source) => source.assetClassTotals?.[assetClass],
  );
  if (classTotals.some((total) => total === undefined)) return null;
  const totals = classTotals as DailyAssetClassTotal[];
  const sum = (currency: "USD" | "CNY" | "HKD") => {
    if (totals.some((total) => total.total[currency] === null)) return null;
    return decimalAdd(...totals.map((total) => total.total[currency]!));
  };
  const complete = totals.every((total) => total.complete);
  return {
    complete,
    status: totals.some((total) => total.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
    total: {
      USD: sum("USD"),
      CNY: sum("CNY"),
      HKD: sum("HKD"),
    },
  };
}

export function mergeDailyTrendObservation(
  previous: DailyAssetTrendObservation | undefined,
  next: DailyAssetTrendObservation,
): DailyAssetTrendObservation {
  if (!previous || previous.day !== next.day) return next;
  const previousBySourceId = new Map(
    previous.sources.map((source) => [source.sourceId, source]),
  );
  // 新观测声明当前参与的来源集合；仅沿用同日有效的来源值。
  const sources = next.sources.map((source) => {
    const previousSource = previousBySourceId.get(source.sourceId);
    const previousUsable = previousSource?.complete &&
      (previousSource.status ?? "complete") === "complete" &&
      (previousSource.kind === "manual" || shanghaiDay(previousSource.capturedAt) === next.day);
    return previousUsable && (!source.complete || source.capturedAt < previousSource.capturedAt)
      ? previousSource : source;
  });
  const sum = (currency: "USD" | "CNY" | "HKD") => {
    const values = sources.flatMap((source) => source.total[currency] ?? []);
    return values.length > 0 ? decimalAdd(...values) : null;
  };
  const total = { USD: sum("USD"), CNY: sum("CNY"), HKD: sum("HKD") };
  const complete =
    sources.length > 0 &&
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
