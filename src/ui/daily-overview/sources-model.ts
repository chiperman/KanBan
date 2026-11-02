import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { decimalCompare, decimalSubtract } from "@/domain/decimal";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import {
  buildTotalValuation,
  convertCurrencyAmount,
  sourceReportingConversionRates,
  type ReportingCurrency,
} from "@/domain/valuation";
import type {
  AssetSourceSummary,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
} from "@/server/ports";
import { sourceSyncStatus } from "@/ui/asset-source-status";

export type OverviewSource = Omit<AssetSourceSummary, "credentialReference" | "permissions">;

type SourceComparison =
  | { state: "changed"; change: string; previousAmount: string }
  | { state: "scope-change" }
  | { state: "unavailable" };

function sourceHealth(source: OverviewSource): {
  label: string;
  tone: "error" | "success" | "warning" | "muted";
} {
  if (source.lifecycle === "disconnected") {
    return { label: "已断开，保留最后快照", tone: "muted" };
  }
  const sync = sourceSyncStatus(source);
  if (sync !== null) return sync;
  if (source.snapshot.coverage?.totalIsAuthoritative === true) {
    if (source.snapshot.coverage.status === "partial") {
      return { label: "来源总额已确认，明细范围有限", tone: "success" };
    }
    if (source.snapshot.coverage.status === "unknown") {
      return { label: "来源总额已确认，明细范围待确认", tone: "success" };
    }
  }
  if (source.snapshot.coverage?.status === "unknown") {
    return { label: "来源总额待确认", tone: "warning" };
  }
  if (source.snapshot.coverage?.status === "partial") {
    return { label: "来源总额覆盖不完整", tone: "warning" };
  }
  if (
    source.snapshot.coverage?.products.some(
      (product) => product.capability === "aggregate-only" && product.freshness === "current",
    )
  ) {
    return { label: "来源账户/平台总额，部分仅汇总", tone: "success" };
  }
  return { label: "来源总额已确认", tone: "success" };
}

function sourceTotalInCurrency(
  source: OverviewSource,
  currency: ReportingCurrency,
  reportingRates: OverviewSource["snapshot"]["exchangeRates"],
): string | null {
  const total = portfolioSourceTotal(source);
  return convertCurrencyAmount(
    total.amount,
    total.currency,
    currency,
    sourceReportingConversionRates(source, reportingRates),
  );
}

function sourceComparison(
  currentAmount: string | null,
  currentComparable: boolean,
  priorObservation: DailyAssetTrendObservation | null,
  priorSource: DailyAssetSourceSnapshot | undefined,
  currency: ReportingCurrency,
): SourceComparison {
  if (!currentComparable || currentAmount === null || priorObservation === null) {
    return { state: "unavailable" };
  }
  if (priorSource === undefined) {
    return { state: "scope-change" };
  }
  const previousAmount = priorSource.total[currency] ?? null;
  const previousComplete =
    priorSource.complete && (priorSource.status === undefined || priorSource.status === "complete");
  if (!previousComplete || previousAmount === null) {
    return { state: "unavailable" };
  }
  return {
    state: "changed",
    change: decimalSubtract(currentAmount, previousAmount),
    previousAmount,
  };
}

export function buildOverviewSources({
  currency,
  longbridgeRates,
  priorObservation,
  recordedSources,
}: {
  currency: ReportingCurrency;
  longbridgeRates: ReturnType<typeof longbridgeReferenceRates>;
  priorObservation: DailyAssetTrendObservation | null;
  recordedSources: OverviewSource[];
}) {
  const priorSourcesById = new Map(
    priorObservation?.sources.map((source) => [source.sourceId, source]),
  );
  return recordedSources
    .map((source) => {
      const health = sourceHealth(source);
      const valuation = buildTotalValuation([source], currency, "source", recordedSources);
      const sourceAmount = sourceTotalInCurrency(source, currency, longbridgeRates);
      const currentComparable =
        source.lifecycle !== "disconnected" &&
        sourceSyncStatus(source) === null &&
        !valuation.incomplete;
      return {
        source,
        amount: sourceAmount,
        health,
        comparison: sourceComparison(
          sourceAmount,
          currentComparable,
          priorObservation,
          priorSourcesById.get(source.id),
          currency,
        ),
      };
    })
    .toSorted((left, right) => {
      if (left.amount === null) return right.amount === null ? 0 : 1;
      if (right.amount === null) return -1;
      return decimalCompare(right.amount, left.amount);
    });
}

export function buildOverviewSourceIssues({
  currency,
  recordedSources,
  sourceSummaries,
}: {
  currency: ReportingCurrency;
  recordedSources: OverviewSource[];
  sourceSummaries: ReturnType<typeof buildOverviewSources>;
}) {
  return sourceSummaries.flatMap(({ amount: sourceAmount, health, source }) => {
    const valuation = buildTotalValuation([source], "USD", "source", recordedSources);
    const hasIssue = health.tone !== "success" || sourceAmount === null || valuation.incomplete;
    if (!hasIssue) return [];
    return [
      {
        id: source.id,
        syncOnly: source.sync.error !== null && sourceAmount !== null && !valuation.incomplete,
        amount: sourceAmount,
        label: assetSourceDisplayName(source),
        status:
          sourceAmount === null
            ? `无法折算为 ${currency}`
            : valuation.incomplete && health.tone === "success"
              ? "估值不完整"
              : health.label,
        tone: source.sync.error !== null ? "error" : health.tone,
      },
    ];
  });
}
