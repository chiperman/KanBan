import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToFixed,
  decimalTruncateToFixed,
} from "@/domain/decimal";
import type {
  AssetExchangeRate,
  AssetHolding,
  AssetMoney,
  AssetSnapshot,
  AssetSourceSummary,
} from "@/server/ports";

export type ValuationSource = Pick<
  AssetSourceSummary,
  "id" | "kind" | "label" | "snapshot" | "sync"
>;

export type ReportingCurrency = "USD" | "CNY";
export type DistributionDimension = "class" | "source" | "currency";

export interface ValuationGroup {
  key: string;
  label: string;
  amount: string | null;
}

export interface TotalValuation {
  amount: string | null;
  currency: ReportingCurrency;
  incomplete: boolean;
  unvaluedCount: number;
  expiredCount: number;
  conversion: AssetExchangeRate | null;
  groups: ValuationGroup[];
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
    const sourceAmount = convert(
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
  const allRates = sources.flatMap((source) => source.snapshot.exchangeRates);
  const conversionObservation = currency === "CNY"
    ? rateFor(allRates, "USD", "CNY")
    : null;
  const conversion = conversionObservation?.rate ?? null;
  let totalUsd = "0";
  let incomplete = false;
  let unvaluedCount = 0;
  let expiredCount = 0;
  let convertedSourceCount = 0;
  const sourceTotals = new Map<string, string>();

  for (const source of sources) {
    if (source.sync.status === "expired") expiredCount += 1;
    const total = convert(
      source.snapshot.total.amount,
      source.snapshot.total.currency,
      "USD",
      source.snapshot.exchangeRates,
    );
    if (total === null) {
      incomplete = true;
    } else {
      convertedSourceCount += 1;
      totalUsd = decimalAdd(totalUsd, total);
      sourceTotals.set(source.id, total);
    }
    unvaluedCount += source.snapshot.holdings.filter(
      (holding) =>
        holding.valuation.status === "unvalued" ||
        holding.sourceMarketValue === null,
    ).length;
  }
  incomplete ||= unvaluedCount > 0;

  const groupsUsd = new Map<string, ValuationGroup>();
  if (dimension === "source") {
    for (const source of sources) {
      const amount = sourceTotals.get(source.id);
      if (amount) addGroup(groupsUsd, source.id, source.label, amount);
    }
  } else {
    for (const source of sources) {
      let holdingTotalUsd = "0";
      for (const holding of source.snapshot.holdings) {
        if (holding.sourceMarketValue === null) continue;
        const amount = convert(
          holding.sourceMarketValue.amount,
          holding.sourceMarketValue.currency,
          "USD",
          source.snapshot.exchangeRates,
        );
        if (amount === null) {
          incomplete = true;
          continue;
        }
        holdingTotalUsd = decimalAdd(holdingTotalUsd, amount);
        if (dimension === "class") {
          addGroup(
            groupsUsd,
            holding.assetClass,
            holding.assetClass === "securities" ? "证券" : "加密资产",
            amount,
          );
        } else {
          addGroup(groupsUsd, holding.currency, holding.currency, amount);
        }
      }
      const sourceTotal = sourceTotals.get(source.id);
      if (sourceTotal) {
        const residual = decimalAdd(sourceTotal, `-${holdingTotalUsd}`);
        if (decimalCompare(residual, "0") > 0) {
          addGroup(
            groupsUsd,
            dimension === "class" ? "other" : source.snapshot.total.currency,
            dimension === "class" ? "现金及其他" : source.snapshot.total.currency,
            residual,
          );
        } else if (decimalCompare(residual, "0") < 0) {
          incomplete = true;
          addGroup(
            groupsUsd,
            `reconciliation:${source.id}`,
            "估值对账差额",
            residual,
          );
        }
      }
    }
  }

  const displayAmount = sources.length > 0 && convertedSourceCount === 0
    ? null
    : convert(totalUsd, "USD", currency, allRates);
  if (currency === "CNY" && !conversion) incomplete = true;
  let groups = [...groupsUsd.values()].map((group) => ({
    ...group,
    amount: group.amount === null
      ? null
      : convert(group.amount, "USD", currency, allRates),
  }));
  if (dimension === "class") {
    const rank = (key: string) =>
      key === "securities"
        ? 0
        : key === "crypto"
          ? 1
          : key === "other"
            ? 2
            : key.startsWith("reconciliation:")
              ? 3
              : 4;
    groups.sort((left, right) => rank(left.key) - rank(right.key));
  }
  if (
    displayAmount !== null &&
    groups.length > 0 &&
    groups.every((group) => group.amount !== null)
  ) {
    const roundedTotal = decimalToFixed(displayAmount, 2);
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
  return {
    amount: displayAmount,
    currency,
    incomplete,
    unvaluedCount,
    expiredCount,
    conversion,
    groups,
  };
}
