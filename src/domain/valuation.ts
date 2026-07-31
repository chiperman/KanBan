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
import type {
  AssetExchangeRate,
  AssetHolding,
  AssetMoney,
  AssetSnapshot,
  AssetSourceSummary,
} from "@/server/ports";

export type ValuationSource = Pick<
  AssetSourceSummary,
  "id" | "kind" | "label" | "displayName" | "snapshot" | "sync"
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
      decimalCompare(coverage.unexplainedValue.amount, "0") !== 0
    ) ||
    coverage.excludedPositiveAccounts.length > 0
  );
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

function convert(
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

/** 优先使用直接汇率；缺失时仅允许经 USD 进行两段可靠换算。 */
export function convertCurrencyAmount(
  amount: string,
  from: string,
  to: string,
  rates: AssetExchangeRate[],
): string | null {
  const direct = convert(amount, from, to, rates);
  if (direct !== null || from === "USD" || to === "USD") return direct;
  const inUsd = convert(amount, from, "USD", rates);
  return inUsd === null ? null : convert(inUsd, "USD", to, rates);
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
): TotalValuation {
  const longbridgeRates = sources.flatMap((source) =>
    source.kind === "longbridge" ? source.snapshot.exchangeRates : [],
  );
  const allRates = [
    ...longbridgeRates,
    ...sources.flatMap((source) => source.snapshot.exchangeRates),
  ];
  const conversionObservation = currency === "USD"
    ? null
    : rateFor(allRates, "USD", currency);
  const conversion = conversionObservation
    ? {
        ...conversionObservation.rate,
        baseCurrency: "USD",
        quoteCurrency: currency,
        rate: conversionObservation.inverse
          ? decimalDivide("1", conversionObservation.rate.rate)
          : conversionObservation.rate.rate,
      }
    : null;
  let totalUsd = "0";
  let incomplete = false;
  let unvaluedCount = 0;
  let expiredCount = 0;
  let convertedSourceCount = 0;
  let aggregateOnlySourceCount = 0;
  const sourceTotals = new Map<string, string>();
  const coverageIssues: ValuationCoverageIssue[] = [];

  for (const source of sources) {
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
      coverageIssues.push({
        sourceId: source.id,
        sourceLabel: assetSourceDisplayName(source),
        status: source.snapshot.coverage.status,
      });
      if (coverageHasKnownValueGap(source.snapshot.coverage)) {
        incomplete = true;
      }
    }
    const total = convertCurrencyAmount(
      source.snapshot.total.amount,
      source.snapshot.total.currency,
      "USD",
      allRates,
    );
    if (total === null) {
      incomplete = true;
    } else {
      convertedSourceCount += 1;
      totalUsd = decimalAdd(totalUsd, total);
      sourceTotals.set(source.id, total);
    }
    if (source.snapshot.coverage?.status !== "complete") {
      unvaluedCount += source.snapshot.holdings.filter(
        holdingMakesTotalIncomplete,
      ).length;
    }
  }
  incomplete ||= unvaluedCount > 0;

  const groupsUsd = new Map<string, ValuationGroup>();
  const reconciliationIssuesUsd: ValuationReconciliationIssue[] = [];
  let hasNonAuthoritativePositiveResidual = false;
  for (const source of sources) {
    const sourceTotal = sourceTotals.get(source.id);
    const quoteUnavailableCount = source.snapshot.holdings.filter(
      (holding) => holding.valuation.status === "quote-unavailable",
    ).length;
    if (quoteUnavailableCount > 0) {
      reconciliationIssuesUsd.push({
        kind: "quote-unavailable",
        sourceId: source.id,
        sourceLabel: assetSourceDisplayName(source),
        amount: null,
        unvaluedCount: 0,
        quoteUnavailableCount,
      });
    }
    if (dimension === "source" && sourceTotal) {
      addGroup(
        groupsUsd,
        source.id,
        assetSourceDisplayName(source),
        sourceTotal,
      );
    }

    let holdingTotalUsd = "0";
    for (const holding of source.snapshot.holdings) {
      if (holding.sourceMarketValue === null) continue;
      const amount = convertCurrencyAmount(
        holding.sourceMarketValue.amount,
        holding.sourceMarketValue.currency,
        "USD",
        allRates,
      );
      if (amount === null) {
        incomplete = true;
        continue;
      }
      holdingTotalUsd = decimalAdd(holdingTotalUsd, amount);
      if (dimension === "source") continue;
      if (dimension === "class") {
        addGroup(
          groupsUsd,
          holding.assetClass,
          holding.assetClass === "securities"
            ? "证券"
            : holding.assetClass === "crypto"
              ? "加密资产"
              : "现金",
          amount,
        );
      } else {
        addGroup(groupsUsd, holding.currency, holding.currency, amount);
      }
    }
    if (sourceTotal) {
      const residual = decimalAdd(sourceTotal, `-${holdingTotalUsd}`);
      if (
        dimension !== "source" &&
        decimalCompare(residual, "0") > 0 &&
        quoteUnavailableCount === 0
      ) {
        if (source.snapshot.coverage?.status !== "complete") {
          hasNonAuthoritativePositiveResidual = true;
        }
        addGroup(
          groupsUsd,
          dimension === "class" ? "other" : source.snapshot.total.currency,
          dimension === "class" ? "现金及其他" : source.snapshot.total.currency,
          residual,
        );
      } else if (
        decimalCompare(residual, "0") < 0 &&
        quoteUnavailableCount === 0
      ) {
        if (source.snapshot.coverage?.status !== "complete") {
          incomplete = true;
        }
        reconciliationIssuesUsd.push({
          kind: "mismatch",
          sourceId: source.id,
          sourceLabel: assetSourceDisplayName(source),
          amount: residual,
          unvaluedCount: source.snapshot.holdings.filter(
            holdingMakesTotalIncomplete,
          ).length,
          quoteUnavailableCount: 0,
        });
      }
    }
  }
  if (
    dimension === "class" &&
    groupsUsd.has("cash") &&
    groupsUsd.has("other") &&
    hasNonAuthoritativePositiveResidual
  ) {
    const other = groupsUsd.get("other")!;
    groupsUsd.set("other", { ...other, label: "未解释差额" });
    incomplete = true;
  }

  const displayAmount = sources.length > 0 && convertedSourceCount === 0
    ? null
    : convertCurrencyAmount(totalUsd, "USD", currency, allRates);
  if (currency !== "USD" && !conversion) incomplete = true;
  let groups = [...groupsUsd.values()].map((group) => ({
    ...group,
    amount: group.amount === null
      ? null
      : convertCurrencyAmount(group.amount, "USD", currency, allRates),
  }));
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
              : 4;
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
  const reconciliationIssues = reconciliationIssuesUsd.map((issue) => ({
    ...issue,
    amount: issue.amount === null
      ? null
      : convertCurrencyAmount(issue.amount, "USD", currency, allRates),
  }));
  return {
    amount: displayAmount,
    currency,
    incomplete,
    unvaluedCount,
    expiredCount,
    conversion,
    groups,
    coverageIssues,
    reconciliationIssues,
    aggregateOnlySourceCount,
  };
}
