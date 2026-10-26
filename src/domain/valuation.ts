import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToFixed,
  decimalTruncateToFixed,
} from "@/domain/decimal";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  activeSourceHoldings,
  includedAssetKeySet,
  portfolioSourceTotal,
  unrecognizedEvmTokenCandidates,
} from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import type { AssetExchangeRate, AssetHolding, AssetMoney, AssetSnapshot } from "@/domain/assets";
import type { AssetSourceSummary } from "@/domain/asset-sources";

export type ValuationSource = Pick<
  AssetSourceSummary,
  | "id"
  | "kind"
  | "investmentBookId"
  | "label"
  | "displayName"
  | "snapshot"
  | "sync"
  | "ignoredAssetKeys"
  | "includedAssetKeys"
  | "hasManualRecord"
  | "manualAssetClass"
>;

export type ReportingCurrency = "USD" | "CNY" | "HKD";
export type DistributionDimension = "class" | "source" | "currency";

export interface ValuationGroup {
  key: string;
  label: string;
  amount: string | null;
}

export interface ValuationReconciliationIssue {
  kind: "mismatch" | "quote-unavailable";
  sourceId: string;
  sourceLabel: string;
  amount: string | null;
  unvaluedCount: number;
  quoteUnavailableCount: number;
}

export interface ValuationCoverageIssue {
  sourceId: string;
  sourceLabel: string;
  status: "partial" | "unknown";
}

export interface TotalValuation {
  amount: string | null;
  currency: ReportingCurrency;
  incomplete: boolean;
  unvaluedCount: number;
  expiredCount: number;
  conversion: AssetExchangeRate | null;
  exchangeRateObservations: AssetExchangeRate[];
  groups: ValuationGroup[];
  coverageIssues: ValuationCoverageIssue[];
  reconciliationIssues: ValuationReconciliationIssue[];
  aggregateOnlySourceCount: number;
}

export interface RawAssetPosition {
  symbol: string;
  name: string;
  quantity: string;
  currency: string;
  assetClass: AssetHolding["assetClass"];
  currentPrice: AssetMoney | null;
  priceSource?: string;
  pricedAt?: string;
  unvaluedReason?: string;
  costPrice: string | null;
  platformProfit: string | null;
  changePercent: string | null;
}

/** 汇总可用于统一展示的汇率，保持长桥账户的 USD 观察优先。 */
export function reportingExchangeRatesForSources(
  sources: Array<{
    kind: AssetSourceSummary["kind"];
    hasManualRecord?: boolean;
    snapshot: Pick<AssetSnapshot, "exchangeRates">;
  }>,
): AssetExchangeRate[] {
  const recordedSources = sources.filter(hasManualAssetRecord);
  return [
    ...recordedSources.flatMap((source) =>
      source.kind === "longbridge" ? source.snapshot.exchangeRates : []
    ),
    ...recordedSources.flatMap((source) => source.snapshot.exchangeRates),
  ];
}

const REPORTING_CURRENCIES = new Set(["CNY", "HKD"]);

function isLongbridgeReportingRate(rate: AssetExchangeRate): boolean {
  return (
    (rate.baseCurrency === "USD" &&
      REPORTING_CURRENCIES.has(rate.quoteCurrency)) ||
    (rate.quoteCurrency === "USD" &&
      REPORTING_CURRENCIES.has(rate.baseCurrency))
  );
}

/**
 * CNY/HKD 只能使用长桥的 USD 参考观察。来源原生汇率仍可用于先折回 USD，
 * 但不能成为报告货币的替代或后备汇率。
 */
export function longbridgeReportingExchangeRatesForSources(
  sources: Array<{
    kind: AssetSourceSummary["kind"];
    hasManualRecord?: boolean;
    snapshot: Pick<AssetSnapshot, "exchangeRates">;
  }>,
): AssetExchangeRate[] {
  return sources
    .filter((source) => source.kind === "longbridge")
    .flatMap((source) => source.snapshot.exchangeRates)
    .filter(isLongbridgeReportingRate)
    .toSorted((left, right) => right.observedAt.localeCompare(left.observedAt));
}

export function sourceReportingConversionRates(
  source: {
    snapshot: Pick<AssetSnapshot, "exchangeRates">;
  },
  reportingRates: AssetExchangeRate[],
): AssetExchangeRate[] {
  return [
    ...reportingRates,
    ...source.snapshot.exchangeRates.filter(
      (rate) => !isLongbridgeReportingRate(rate),
    ),
  ];
}

export function compareNullableDecimalDescending(
  left: string | null,
  right: string | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return decimalCompare(right, left);
}

export function holdingMakesTotalIncomplete(holding: AssetHolding): boolean {
  return (
    holding.valuation.status === "unvalued" ||
    (
      holding.sourceMarketValue === null &&
      holding.valuation.status !== "quote-unavailable"
    )
  );
}

function coverageHasKnownValueGap(
  coverage: NonNullable<AssetSnapshot["coverage"]>,
): boolean {
  return (
    (
      coverage.unexplainedValue !== null &&
      !coverage.totalIsAuthoritative &&
      decimalCompare(coverage.unexplainedValue.amount, "0") !== 0
    ) ||
    coverage.excludedPositiveAccounts.length > 0
  );
}

function coverageNeedsTotalWarning(
  coverage: NonNullable<AssetSnapshot["coverage"]>,
): boolean {
  return coverage.status === "unknown" || coverageHasKnownValueGap(coverage);
}

function rateFor(
  rates: AssetExchangeRate[],
  from: string,
  to: string,
): { rate: AssetExchangeRate; inverse: boolean } | null {
  const direct = rates.find(
    (rate) => rate.baseCurrency === from && rate.quoteCurrency === to,
  );
  if (direct) return { rate: direct, inverse: false };
  const inverse = rates.find(
    (rate) => rate.baseCurrency === to && rate.quoteCurrency === from,
  );
  return inverse ? { rate: inverse, inverse: true } : null;
}

function convertDirect(
  amount: string,
  from: string,
  to: string,
  rates: AssetExchangeRate[],
): string | null {
  if (from === to) return amount;
  const observation = rateFor(rates, from, to);
  if (!observation) return null;
  return observation.inverse
    ? decimalDivide(amount, observation.rate.rate)
    : decimalMultiply(amount, observation.rate.rate);
}

/**
 * 使用来源原生汇率换算金额；当直接汇率缺失时，只允许经 USD 的两段可靠换算。
 * 展示币种的 USD/CNY/HKD 汇率由调用方放在 rates 首位，以保持长桥账户汇率优先。
 */
export function convertCurrencyAmount(
  amount: string,
  from: string,
  to: string,
  rates: AssetExchangeRate[],
): string | null {
  const direct = convertDirect(amount, from, to, rates);
  if (direct !== null || from === "USD" || to === "USD") return direct;
  const inUsd = convertDirect(amount, from, "USD", rates);
  return inUsd === null
    ? null
    : convertDirect(inUsd, "USD", to, rates);
}

/** 从来源原始数量、价格及显式汇率生成快照，未估值项不按零计入总额。 */
export function buildSnapshotFromPositions(input: {
  positions: RawAssetPosition[];
  sourceCurrency: string;
  exchangeRates: AssetExchangeRate[];
  syncedAt: string;
  adjustment?: string;
}): AssetSnapshot {
  let total = input.adjustment ?? "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    const {
      priceSource,
      pricedAt,
      unvaluedReason,
      ...holding
    } = position;
    if (position.currentPrice === null) {
      return {
        ...holding,
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "unvalued",
          reason: unvaluedReason ?? "来源没有可靠价格",
        },
      };
    }
    const marketValue = decimalMultiply(
      position.quantity,
      position.currentPrice.amount,
    );
    const sourceAmount = convertCurrencyAmount(
      marketValue,
      position.currentPrice.currency,
      input.sourceCurrency,
      input.exchangeRates,
    );
    if (sourceAmount === null) {
      return {
        ...holding,
        marketValue,
        sourceMarketValue: null,
        valuation: {
          status: "unvalued",
          reason:
            unvaluedReason ??
            `缺少 ${position.currentPrice.currency}/${input.sourceCurrency} 显式汇率`,
        },
      };
    }
    total = decimalAdd(total, sourceAmount);
    return {
      ...holding,
      marketValue,
      sourceMarketValue: {
        amount: sourceAmount,
        currency: input.sourceCurrency,
      },
      valuation: {
        status: "valued",
        priceSource: priceSource ?? "来源原生行情",
        pricedAt: pricedAt ?? input.syncedAt,
      },
    };
  });
  return {
    total: { amount: total, currency: input.sourceCurrency },
    holdings,
    exchangeRates: input.exchangeRates,
    syncedAt: input.syncedAt,
  };
}

function addGroup(groups: Map<string, ValuationGroup>, key: string, label: string, amount: string) {
  const current = groups.get(key);
  groups.set(key, {
    key,
    label,
    amount: decimalAdd(current?.amount ?? "0", amount),
  });
}

export function buildTotalValuation(
  sources: ValuationSource[],
  currency: ReportingCurrency,
  dimension: DistributionDimension,
  rateSources: ValuationSource[] = sources,
): TotalValuation {
  const recordedSources = sources.filter(hasManualAssetRecord);
  const recordedRateSources = rateSources.filter(hasManualAssetRecord);
  const reportingRates = longbridgeReportingExchangeRatesForSources(
    recordedRateSources,
  );
  const displayRate = (quoteCurrency: "CNY" | "HKD") => {
    const observation = rateFor(reportingRates, "USD", quoteCurrency);
    return observation
      ? {
          ...observation.rate,
          baseCurrency: "USD",
          quoteCurrency,
          rate: observation.inverse
            ? decimalDivide("1", observation.rate.rate)
            : observation.rate.rate,
        }
      : null;
  };
  const exchangeRateObservations = (["CNY", "HKD"] as const).flatMap(
    (quoteCurrency) => {
      const observation = displayRate(quoteCurrency);
      return observation === null ? [] : [observation];
    },
  );
  const conversion = currency === "USD" ? null : displayRate(currency);
  let totalInReportingCurrency = "0";
  let incomplete = false;
  let unvaluedCount = 0;
  let expiredCount = 0;
  let convertedSourceCount = 0;
  let aggregateOnlySourceCount = 0;
  const sourceTotals = new Map<string, string>();
  const coverageIssues: ValuationCoverageIssue[] = [];

  for (const source of recordedSources) {
    const activeHoldings = activeSourceHoldings(source);
    if (source.sync.status === "expired") expiredCount += 1;
    if (
      source.snapshot.coverage?.products.some(
        ({ capability, freshness }) =>
          capability === "aggregate-only" && freshness === "current",
      )
    ) {
      aggregateOnlySourceCount += 1;
    }
    if (
      source.snapshot.coverage !== undefined &&
      source.snapshot.coverage.status !== "complete"
    ) {
      if (coverageNeedsTotalWarning(source.snapshot.coverage)) {
        coverageIssues.push({
          sourceId: source.id,
          sourceLabel: assetSourceDisplayName(source),
          status: source.snapshot.coverage.status,
        });
      }
      if (coverageHasKnownValueGap(source.snapshot.coverage)) {
        incomplete = true;
      }
    }
    const sourceRates = sourceReportingConversionRates(source, reportingRates);
    const portfolioTotal = portfolioSourceTotal(source);
    const total = convertCurrencyAmount(
      portfolioTotal.amount,
      portfolioTotal.currency,
      currency,
      sourceRates,
    );
    if (total === null) {
      incomplete = true;
    } else {
      convertedSourceCount += 1;
      totalInReportingCurrency = decimalAdd(totalInReportingCurrency, total);
      sourceTotals.set(source.id, total);
    }
    if (source.snapshot.coverage?.status !== "complete") {
      unvaluedCount += activeHoldings.filter(
        holdingMakesTotalIncomplete,
      ).length;
      const activeAssetKeys = new Set(
        activeHoldings.flatMap(({ sourceAsset }) =>
          sourceAsset === undefined ? [] : [sourceAsset],
        ),
      );
      const includedAssetKeys = includedAssetKeySet(source);
      unvaluedCount += unrecognizedEvmTokenCandidates(source).filter(
        ({ sourceAsset }) =>
          includedAssetKeys.has(sourceAsset) &&
          !activeAssetKeys.has(sourceAsset),
      ).length;
    }
  }
  incomplete ||= unvaluedCount > 0;

  const groupsInReportingCurrency = new Map<string, ValuationGroup>();
  const reconciliationIssuesInReportingCurrency: ValuationReconciliationIssue[] = [];
  let hasNonAuthoritativePositiveResidual = false;
  for (const source of recordedSources) {
    const activeHoldings = activeSourceHoldings(source);
    const sourceTotal = sourceTotals.get(source.id);
    const sourceRates = sourceReportingConversionRates(source, reportingRates);
    const quoteUnavailableCount = activeHoldings.filter(
      (holding) => holding.valuation.status === "quote-unavailable",
    ).length;
    if (quoteUnavailableCount > 0) {
      reconciliationIssuesInReportingCurrency.push({
        kind: "quote-unavailable",
        sourceId: source.id,
        sourceLabel: assetSourceDisplayName(source),
        amount: null,
        unvaluedCount: 0,
        quoteUnavailableCount,
      });
    }
    const coverage = source.snapshot.coverage;
    const coverageResidual = coverage?.unexplainedValue;
    if (
      coverage?.totalIsAuthoritative &&
      coverageResidual != null &&
      decimalCompare(coverageResidual.amount, "0") !== 0
    ) {
      reconciliationIssuesInReportingCurrency.push({
        kind: "mismatch",
        sourceId: source.id,
        sourceLabel: assetSourceDisplayName(source),
        amount: convertCurrencyAmount(
          coverageResidual.amount,
          coverageResidual.currency,
          currency,
          sourceRates,
        ),
        unvaluedCount: 0,
        quoteUnavailableCount: 0,
      });
    }
    if (dimension === "source" && sourceTotal) {
      addGroup(
        groupsInReportingCurrency,
        source.id,
        assetSourceDisplayName(source),
        sourceTotal,
      );
    }
    if (source.kind === "manual") {
      if (sourceTotal && dimension === "class") {
        const assetClass = source.manualAssetClass ?? "unclassified";
        addGroup(
          groupsInReportingCurrency,
          assetClass,
          assetClass === "securities"
            ? "证券"
            : assetClass === "crypto"
              ? "加密资产"
              : assetClass === "cash"
                ? "现金"
                : assetClass === "other"
                  ? "其他投资资产"
                  : "待分类",
          sourceTotal,
        );
      } else if (sourceTotal && dimension === "currency") {
        addGroup(
          groupsInReportingCurrency,
          source.snapshot.total.currency,
          source.snapshot.total.currency,
          sourceTotal,
        );
      }
      continue;
    }

    let holdingTotalInReportingCurrency = "0";
    for (const holding of activeHoldings) {
      if (holding.sourceMarketValue === null) continue;
      const amount = convertCurrencyAmount(
        holding.sourceMarketValue.amount,
        holding.sourceMarketValue.currency,
        currency,
        sourceRates,
      );
      if (amount === null) {
        incomplete = true;
        continue;
      }
      holdingTotalInReportingCurrency = decimalAdd(
        holdingTotalInReportingCurrency,
        amount,
      );
      if (dimension === "source") continue;
      if (dimension === "class") {
        addGroup(
          groupsInReportingCurrency,
          holding.assetClass,
          holding.assetClass === "securities"
            ? "证券"
            : holding.assetClass === "crypto"
              ? "加密资产"
              : "现金",
          amount,
        );
      } else {
        addGroup(
          groupsInReportingCurrency,
          holding.currency,
          holding.currency,
          amount,
        );
      }
    }
    if (sourceTotal) {
      const residual = decimalAdd(
        sourceTotal,
        `-${holdingTotalInReportingCurrency}`,
      );
      if (
        dimension !== "source" &&
        decimalCompare(residual, "0") > 0 &&
        quoteUnavailableCount === 0
      ) {
        if (
          coverage?.status !== "complete" &&
          !coverage?.totalIsAuthoritative
        ) {
          hasNonAuthoritativePositiveResidual = true;
        }
        addGroup(
          groupsInReportingCurrency,
          dimension === "class" ? "other" : source.snapshot.total.currency,
          dimension === "class" ? "现金及其他" : source.snapshot.total.currency,
          residual,
        );
      }
    }
  }
  if (
    dimension === "class" &&
    groupsInReportingCurrency.has("cash") &&
    groupsInReportingCurrency.has("other") &&
    hasNonAuthoritativePositiveResidual
  ) {
    const other = groupsInReportingCurrency.get("other")!;
    groupsInReportingCurrency.set("other", { ...other, label: "未解释差额" });
    incomplete = true;
  }

  const displayAmount =
    recordedSources.length === 0 || convertedSourceCount === 0
      ? null
      : totalInReportingCurrency;
  let groups = [...groupsInReportingCurrency.values()];
  if (dimension === "class") {
    const rank = (key: string) =>
      key === "securities"
        ? 0
        : key === "crypto"
          ? 1
          : key === "cash"
            ? 2
            : key === "other"
              ? 3
              : key === "unclassified"
                ? 4
                : 5;
    groups.sort((left, right) => rank(left.key) - rank(right.key));
  }
  if (
    groups.length > 0 &&
    groups.every((group) => group.amount !== null)
  ) {
    const roundedTotal = decimalToFixed(
      decimalAdd(...groups.map((group) => group.amount!)),
      2,
    );
    const allocations = groups.map((group, index) => {
      const truncated = decimalTruncateToFixed(group.amount!, 2);
      return {
        index,
        amount: truncated,
        remainder: decimalSubtract(group.amount!, truncated),
      };
    });
    const allocated = decimalAdd(...allocations.map((item) => item.amount));
    let difference = decimalSubtract(roundedTotal, allocated);
    const direction = decimalCompare(difference, "0");
    if (direction !== 0) {
      allocations.sort((left, right) => {
        const order = decimalCompare(left.remainder, right.remainder);
        return direction > 0 ? -order : order;
      });
      const step = direction > 0 ? "0.01" : "-0.01";
      let cursor = 0;
      while (decimalCompare(difference, "0") !== 0) {
        const target = allocations[cursor % allocations.length];
        target.amount = decimalAdd(target.amount, step);
        difference = decimalSubtract(difference, step);
        cursor += 1;
      }
    }
    allocations.sort((left, right) => left.index - right.index);
    groups = groups.map((group, index) => ({
      ...group,
      amount: allocations[index].amount,
    }));
  }
  groups = groups.toSorted((left, right) =>
    compareNullableDecimalDescending(left.amount, right.amount),
  );
  const reconciliationIssues = reconciliationIssuesInReportingCurrency;
  return {
    amount: displayAmount,
    currency,
    incomplete,
    unvaluedCount,
    expiredCount,
    conversion,
    exchangeRateObservations,
    groups,
    coverageIssues,
    reconciliationIssues,
    aggregateOnlySourceCount,
  };
}
