import type {
  AssetHolding,
  AssetSnapshotCoverage,
  AssetSourceSummary,
  EvmUnrecognizedToken,
} from "@/server/ports";
import { decimalAdd } from "@/domain/decimal";

const EVM_TOKEN_ASSET_KEY_PATTERN =
  /^evm:(1|56):0x[0-9a-f]{40}$/;
const EVM_NATIVE_ASSET_KEY_PATTERN = /^evm:(1|56):native$/;

type SourceWithEvmTokenPreferences = Pick<
  AssetSourceSummary,
  "kind" | "ignoredAssetKeys" | "includedAssetKeys" | "snapshot"
>;

export class InvalidEvmTokenPreferenceError extends Error {}

export function isEvmTokenAssetKey(value: string): boolean {
  return EVM_TOKEN_ASSET_KEY_PATTERN.test(value);
}

/** EVM 观察钱包中可由所有者控制显示范围的普通资产。
 *
 * 协议头寸使用各自的 providerPositionId，不能与原生币或 ERC-20
 * 混用这个开关，避免隐藏一部分协议仓位后失去产品语义。
 */
export function isEvmManagedAssetKey(value: string): boolean {
  return (
    EVM_NATIVE_ASSET_KEY_PATTERN.test(value) ||
    isEvmTokenAssetKey(value)
  );
}

export function isEvmTokenHolding(
  sourceKind: string,
  holding: AssetHolding,
): boolean {
  return (
    sourceKind.startsWith("evm-watch-") &&
    typeof holding.sourceAsset === "string" &&
    isEvmTokenAssetKey(holding.sourceAsset)
  );
}

export function isEvmManagedHolding(
  sourceKind: string,
  holding: AssetHolding,
): boolean {
  return (
    sourceKind.startsWith("evm-watch-") &&
    typeof holding.sourceAsset === "string" &&
    isEvmManagedAssetKey(holding.sourceAsset)
  );
}

export function isUnrecognizedEvmTokenHolding(
  source: SourceWithEvmTokenPreferences,
  holding: AssetHolding,
): boolean {
  if (!holding.sourceAsset) return false;
  return (
    isEvmTokenHolding(source.kind, holding) &&
    holding.valuation.status === "unvalued" &&
    !ignoredAssetKeySet(source).has(holding.sourceAsset) &&
    !includedAssetKeySet(source).has(holding.sourceAsset)
  );
}

function candidateFromHolding(holding: AssetHolding): EvmUnrecognizedToken | null {
  if (
    holding.sourceAsset === undefined ||
    holding.valuation.status !== "unvalued"
  ) {
    return null;
  }
  return {
    sourceAsset: holding.sourceAsset,
    symbol: holding.symbol,
    name: holding.name,
    quantity: holding.quantity,
    reason: holding.valuation.reason,
  };
}

export function unrecognizedEvmTokenCandidates(
  source: SourceWithEvmTokenPreferences,
): EvmUnrecognizedToken[] {
  if (!source.kind.startsWith("evm-watch-")) return [];
  const candidates = new Map<string, EvmUnrecognizedToken>();
  for (const token of source.snapshot.unrecognizedEvmTokens ?? []) {
    if (isEvmTokenAssetKey(token.sourceAsset)) {
      candidates.set(token.sourceAsset, token);
    }
  }
  for (const holding of source.snapshot.holdings) {
    if (
      !isEvmTokenHolding(source.kind, holding) ||
      holding.valuation.status !== "unvalued"
    ) {
      continue;
    }
    const candidate = candidateFromHolding(holding);
    if (candidate !== null && !candidates.has(candidate.sourceAsset)) {
      candidates.set(candidate.sourceAsset, candidate);
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.sourceAsset.localeCompare(right.sourceAsset),
  );
}

export function ignoredAssetKeySet(
  source: Pick<AssetSourceSummary, "ignoredAssetKeys">,
): Set<string> {
  return new Set(source.ignoredAssetKeys ?? []);
}

export function includedAssetKeySet(
  source: Pick<AssetSourceSummary, "includedAssetKeys">,
): Set<string> {
  return new Set(source.includedAssetKeys ?? []);
}

export function effectiveEvmSnapshotCoverage(
  source: SourceWithEvmTokenPreferences,
): AssetSnapshotCoverage | undefined {
  const coverage = source.snapshot.coverage;
  if (!source.kind.startsWith("evm-watch-") || coverage === undefined) {
    return coverage;
  }
  const products = coverage.products.filter(
    ({ product, capability }) =>
      capability !== "detailed" ||
      source.snapshot.holdings.some(
        (holding) => holding.sourceProduct === product,
      ),
  );
  const effectiveCoverage = products.length === coverage.products.length
    ? coverage
    : { ...coverage, products };
  if (
    effectiveCoverage.unexplainedValue !== null ||
    effectiveCoverage.excludedPositiveAccounts.length > 0
  ) {
    return effectiveCoverage;
  }
  if (effectiveCoverage.products.some(({ capability }) => capability === "unknown")) {
    return effectiveCoverage;
  }
  const ignored = ignoredAssetKeySet(source);
  const included = includedAssetKeySet(source);
  const activeUnvaluedHolding = source.snapshot.holdings.some((holding) => {
    if (holding.valuation.status !== "unvalued") return false;
    if (holding.sourceAsset !== undefined && ignored.has(holding.sourceAsset)) {
      return false;
    }
    return !isUnrecognizedEvmTokenHolding(source, holding);
  });
  const includedUnrecognizedToken = unrecognizedEvmTokenCandidates(source).some(
    ({ sourceAsset }) => included.has(sourceAsset) && !ignored.has(sourceAsset),
  );
  if (activeUnvaluedHolding || includedUnrecognizedToken) {
    return effectiveCoverage.status === "complete"
      ? { ...effectiveCoverage, status: "partial" }
      : effectiveCoverage;
  }
  if (effectiveCoverage.status === "unknown") return effectiveCoverage;
  return effectiveCoverage.status === "complete"
    ? effectiveCoverage
    : { ...effectiveCoverage, status: "complete" };
}

export function withEffectiveEvmSnapshotCoverage<T extends SourceWithEvmTokenPreferences>(
  source: T,
): T {
  const coverage = effectiveEvmSnapshotCoverage(source);
  if (coverage === source.snapshot.coverage) return source;
  const { coverage: _coverage, ...snapshotWithoutCoverage } = source.snapshot;
  return {
    ...source,
    snapshot: coverage === undefined
      ? snapshotWithoutCoverage
      : { ...snapshotWithoutCoverage, coverage },
  } as T;
}

export function activeSourceHoldings(
  source: SourceWithEvmTokenPreferences,
): AssetHolding[] {
  const ignored = ignoredAssetKeySet(source);
  return source.snapshot.holdings.filter(
    (holding) =>
      (holding.sourceAsset === undefined ||
        !ignored.has(holding.sourceAsset)) &&
      !isUnrecognizedEvmTokenHolding(source, holding),
  );
}

export function portfolioSourceTotal(
  source: SourceWithEvmTokenPreferences,
): AssetSourceSummary["snapshot"]["total"] {
  if (
    !source.kind.startsWith("evm-watch-") ||
    (source.ignoredAssetKeys?.length ?? 0) === 0
  ) {
    return source.snapshot.total;
  }
  const amount = decimalAdd(
    ...activeSourceHoldings(source).flatMap((holding) =>
      holding.sourceMarketValue?.currency === source.snapshot.total.currency
        ? [holding.sourceMarketValue.amount]
        : [],
    ),
  );
  return {
    amount,
    currency: source.snapshot.total.currency,
  };
}

export function normalizeIgnoredAssetKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && isEvmManagedAssetKey(item),
      ),
    ),
  ].sort();
}

export function updateEvmTokenPreferences(
  source: SourceWithEvmTokenPreferences,
  assetKeys: string[],
  status: "included" | "ignored" | "unrecognized",
): {
  ignoredAssetKeys: string[];
  includedAssetKeys: string[];
} {
  if (!source.kind.startsWith("evm-watch-")) {
    throw new InvalidEvmTokenPreferenceError("只有 EVM 观察钱包可以忽略代币");
  }
  if (assetKeys.length === 0) {
    throw new InvalidEvmTokenPreferenceError("请至少选择一个代币");
  }
  const available = new Set([
    ...source.snapshot.holdings.flatMap((holding) =>
      isEvmManagedHolding(source.kind, holding) &&
      holding.sourceAsset
        ? [holding.sourceAsset]
        : [],
    ),
    ...unrecognizedEvmTokenCandidates(source).map(
      ({ sourceAsset }) => sourceAsset,
    ),
    ...(source.ignoredAssetKeys ?? []),
    ...(source.includedAssetKeys ?? []),
  ]);
  if (
    assetKeys.some(
      (assetKey) =>
        !isEvmManagedAssetKey(assetKey) ||
        !available.has(assetKey),
    )
  ) {
    throw new InvalidEvmTokenPreferenceError("资产不属于该观察钱包");
  }
  const ignored = ignoredAssetKeySet(source);
  const included = includedAssetKeySet(source);
  for (const assetKey of assetKeys) {
    ignored.delete(assetKey);
    included.delete(assetKey);
    if (status === "ignored") ignored.add(assetKey);
    if (status === "included") included.add(assetKey);
  }
  return {
    ignoredAssetKeys: [...ignored].sort(),
    includedAssetKeys: [...included].sort(),
  };
}
