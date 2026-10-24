import { decimalCompare } from "@/domain/decimal";
import { assetSourceKindMetadata } from "@/domain/asset-source-kinds";
import {
  ignoredAssetKeySet,
  includedAssetKeySet,
  isUnrecognizedEvmTokenHolding,
  unrecognizedEvmTokenCandidates,
} from "@/domain/evm-token-preferences";
import { compareNullableDecimalDescending } from "@/domain/valuation";
import {
  assetHoldingDisplayName,
  assetHoldingKey,
} from "@/ui/asset-product-coverage";

import type { AssetSourceView } from "./types";

export function assetSourceHoldingsModel({
  hideSmallCryptoHoldings,
  holdingsSearchQuery,
  source,
}: {
  hideSmallCryptoHoldings: boolean;
  holdingsSearchQuery: string;
  source: AssetSourceView;
}) {
  const metadata = assetSourceKindMetadata(source.kind);
  const isManual = metadata?.isManual ?? source.kind === "manual";
  const supportsSmallHoldingFilter = metadata?.supportsSmallHoldingFilter ?? false;
  const supportsEvmTokenPreferences = metadata?.supportsEvmTokenPreferences ?? false;
  const supportsProductCoverage = metadata?.supportsProductCoverage ?? false;
  const orderedHoldings = source.snapshot.holdings.toSorted((left, right) =>
    compareNullableDecimalDescending(
      left.sourceMarketValue?.amount ?? null,
      right.sourceMarketValue?.amount ?? null,
    ),
  );
  const cashHoldings = orderedHoldings.filter(
    ({ assetClass }) => assetClass === "cash",
  );
  const positionHoldings = orderedHoldings.filter(
    ({ assetClass }) => assetClass !== "cash",
  );
  const ignoredAssetKeys = ignoredAssetKeySet(source);
  const includedAssetKeys = includedAssetKeySet(source);
  const activePositionHoldings = positionHoldings.filter(
    (holding) =>
      holding.sourceAsset === undefined ||
      !ignoredAssetKeys.has(holding.sourceAsset),
  );
  const unrecognizedHoldings = supportsEvmTokenPreferences
    ? activePositionHoldings.filter((holding) =>
      isUnrecognizedEvmTokenHolding(source, holding)
    )
    : [];
  const unrecognizedAssetKeys = new Set(
    unrecognizedHoldings.flatMap((holding) =>
      holding.sourceAsset ? [holding.sourceAsset] : [],
    ),
  );
  const reviewedPositionHoldings = activePositionHoldings.filter(
    (holding) =>
      holding.sourceAsset === undefined ||
      !unrecognizedAssetKeys.has(holding.sourceAsset),
  );
  const unreadableEvmTokens = supportsEvmTokenPreferences
    ? unrecognizedEvmTokenCandidates(source).filter(
      (token) =>
        token.quantity === null && !ignoredAssetKeys.has(token.sourceAsset),
    )
    : [];
  const cashBalances = cashHoldings.flatMap((holding) =>
    holding.cashBalances ?? [{
      amount: holding.marketValue ?? holding.quantity,
      availableCash: holding.quantity,
      currency: holding.currency,
      frozenCash: "0",
      settlingCash: "0",
      withdrawCash: holding.quantity,
    }]
  );
  const hiddenSmallHoldingCount = supportsSmallHoldingFilter
    ? reviewedPositionHoldings.filter(
      (holding) =>
        holding.marketValue !== null &&
        decimalCompare(holding.marketValue, "1") < 0,
    ).length
    : 0;
  const visibleHoldings = supportsSmallHoldingFilter && hideSmallCryptoHoldings
    ? reviewedPositionHoldings.filter(
      (holding) =>
        holding.marketValue === null ||
        decimalCompare(holding.marketValue, "1") >= 0,
    )
    : reviewedPositionHoldings;
  const normalizedQuery = holdingsSearchQuery.trim().toLocaleLowerCase();
  const searchedHoldings = visibleHoldings.filter((holding) =>
    normalizedQuery.length === 0 || [
      source.label,
      source.displayName,
      assetHoldingDisplayName(holding),
      holding.symbol,
      holding.sourceAsset,
      holding.sourceAccount,
      holding.sourceProduct,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
  );
  const unvaluedCount = visibleHoldings.filter(
    ({ valuation }) => valuation.status === "unvalued",
  ).length;
  const quoteUnavailableCount = visibleHoldings.filter(
    ({ valuation }) => valuation.status === "quote-unavailable",
  ).length;
  const valuedCount =
    visibleHoldings.length - unvaluedCount - quoteUnavailableCount;

  return {
    cashBalances,
    compactProfitColumns: source.kind === "longbridge",
    hasHoldingsSearchQuery: !isManual && normalizedQuery.length > 0,
    hiddenSmallHoldingCount,
    holdingsSearchQuery,
    includedAssetKeys,
    isManual,
    quoteUnavailableCount,
    searchedHoldings,
    showPlatformProfit: visibleHoldings.some(
      (holding) => holding.platformProfit !== null,
    ),
    supportsProductCoverage,
    supportsSmallHoldingFilter,
    unvaluedCount,
    unreadableEvmTokens,
    valuationAriaLabel: quoteUnavailableCount > 0
      ? `${valuedCount} 项已估值，${unvaluedCount} 项未估值，${quoteUnavailableCount} 项行情未接入`
      : `${valuedCount} 项已估值，${unvaluedCount} 项未估值`,
    valuationCaption: unvaluedCount > 0
      ? `${unvaluedCount} 项未估值${
        quoteUnavailableCount > 0 ? `，${quoteUnavailableCount} 项行情未接入` : ""
      }`
      : quoteUnavailableCount > 0
        ? `${quoteUnavailableCount} 项行情未接入`
        : "已全部估值",
    valuationSegments: visibleHoldings.map((holding) => ({
      key: assetHoldingKey(holding),
      tone:
        holding.valuation.status === "unvalued"
          ? "error" as const
          : holding.valuation.status === "quote-unavailable"
            ? "muted" as const
            : "primary" as const,
      value: 1,
    })),
    visibleHoldings,
  };
}
