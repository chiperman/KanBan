import { decimalCompare } from "@/domain/decimal";
import { buildTotalValuation, type ReportingCurrency } from "@/domain/valuation";
import type {
  AssetSourceSummary,
  DailyAssetSnapshot,
  DailyAssetSourceSnapshot,
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
): string | null {
  const valuation = buildTotalValuation([source], currency, "source");
  const hasKnownValue = valuation.groups.some(
    (group) => group.key === source.id && group.amount !== null,
  );
  const onlyUnknownHoldings =
    source.snapshot.holdings.length > 0 &&
    source.snapshot.holdings.every(
      (holding) =>
        holding.sourceMarketValue === null ||
        holding.valuation.status === "unvalued",
    ) &&
    decimalCompare(source.snapshot.total.amount, "0") === 0;
  return hasKnownValue && !onlyUnknownHoldings ? valuation.amount : null;
}

function sourceSnapshot(
  source: AssetSourceSummary,
  capturedAt: string,
): DailyAssetSourceSnapshot {
  const unvalued = source.snapshot.holdings.some(
    (holding) =>
      holding.sourceMarketValue === null ||
      holding.valuation.status === "unvalued",
  );
  const total = {
    USD: sourceValue(source, "USD"),
    CNY: sourceValue(source, "CNY"),
  };
  return {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt,
    complete:
      source.sync.status === "current" &&
      (source.snapshot.coverage === undefined ||
        source.snapshot.coverage.status === "complete") &&
      !unvalued &&
      total.USD !== null,
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
  const sourceSnapshots = sources.map((source) =>
    sourceSnapshot(source, capturedAt),
  );
  const total = {
    USD: totalValue(sources, "USD"),
    CNY: totalValue(sources, "CNY"),
  };
  return {
    day: shanghaiDay(capturedAt),
    capturedAt,
    complete:
      sourceSnapshots.length > 0 &&
      sourceSnapshots.every((source) => source.complete) &&
      total.USD !== null,
    total,
    sources: sourceSnapshots,
  };
}
