import { existsSync, readFileSync } from "node:fs";

import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import { normalizedSourceBookId } from "@/domain/source-investment-book";
import { assertPluginSnapshot } from "@/server/asset-source-plugins/snapshot-validation";
import { shanghaiDay, sourceTrendClassTotals } from "@/domain/daily-asset-snapshots";
import { decimalAdd, decimalCompare, decimalDivide } from "@/domain/decimal";
import { normalizeIgnoredAssetKeys } from "@/domain/evm-token-preferences";
import { parseAssetCards } from "@/server/asset-cards";
import { isLongbridgeUsOptionSymbol } from "@/domain/longbridge-symbols";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import type { DashboardState } from "@/server/persistence/contracts";
import { DASHBOARD_SCHEMA_VERSION } from "@/server/persistence/contracts";
import type { AssetSnapshot, AssetSourceSummary, DailyAssetSnapshot, ImportedAssetSourceHistoryObservation, ManualAssetRecord } from "@/server/ports";

export function migrateAssetSource(raw: unknown): AssetSourceSummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("资产来源数据格式无效");
  }
  const source = raw as Omit<AssetSourceSummary, "kind"> & { kind: unknown };
  if (!isPersistedAssetSourceKind(source.kind)) {
    throw new Error("资产来源类型无效或不受支持");
  }
  if (
    typeof source.snapshot !== "object" ||
    source.snapshot === null ||
    !Array.isArray(source.snapshot.holdings)
  ) {
    throw new Error("资产来源快照格式无效");
  }
  const snapshot = source.snapshot as AssetSnapshot;
  if (source.kind.startsWith("plugin:")) assertPluginSnapshot(snapshot);
  const legacySnapshot =
    !Array.isArray(snapshot.exchangeRates) ||
    snapshot.holdings.some(
      (holding) =>
        !Object.hasOwn(holding, "assetClass") ||
        !Object.hasOwn(holding, "currentPrice") ||
        !Object.hasOwn(holding, "sourceMarketValue") ||
        !Object.hasOwn(holding, "valuation"),
    );
  const exchangeRates = Array.isArray(snapshot.exchangeRates)
    ? snapshot.exchangeRates
    : [];
  const holdings = snapshot.holdings.map((holding) => {
    const legacy = holding as typeof holding & {
      assetClass?: typeof holding.assetClass;
      currentPrice?: typeof holding.currentPrice;
      sourceMarketValue?: typeof holding.sourceMarketValue;
      valuation?: typeof holding.valuation;
    };
    const hasCurrentPrice = Object.hasOwn(legacy, "currentPrice");
    const hasSourceMarketValue = Object.hasOwn(legacy, "sourceMarketValue");
    const hasValuation = Object.hasOwn(legacy, "valuation");
    const canDerivePrice =
      typeof legacy.marketValue === "string" &&
      typeof legacy.quantity === "string" &&
      decimalCompare(legacy.quantity, "0") !== 0;
    const currentPrice = hasCurrentPrice
      ? legacy.currentPrice ?? null
      : canDerivePrice
        ? {
            amount: decimalDivide(legacy.marketValue!, legacy.quantity),
            currency: legacy.currency,
          }
        : null;
    const sourceMarketValue = hasSourceMarketValue
      ? legacy.sourceMarketValue ?? null
      : typeof legacy.marketValue === "string" &&
          legacy.currency === snapshot.total.currency
        ? { amount: legacy.marketValue, currency: snapshot.total.currency }
        : null;
    const persistedValuation = hasValuation ? legacy.valuation : undefined;
    const valuation = persistedValuation
      ? source.kind === "longbridge" &&
          persistedValuation.status === "unvalued" &&
          currentPrice === null &&
          isLongbridgeUsOptionSymbol(legacy.symbol)
        ? {
            status: "quote-unavailable" as const,
            reason: "Longbridge Open API 未接入期权行情",
          }
        : persistedValuation
      : currentPrice !== null && sourceMarketValue !== null
        ? {
            status: "valued" as const,
            priceSource: `${source.label} 旧快照`,
            pricedAt: snapshot.syncedAt,
          }
        : {
            status: "unvalued" as const,
            reason: currentPrice === null
              ? "旧快照没有可靠价格"
              : `缺少 ${legacy.currency}/${snapshot.total.currency} 显式汇率`,
          };
    return {
      ...legacy,
      assetClass: legacy.assetClass ?? "securities",
      currentPrice,
      sourceMarketValue,
      valuation,
    };
  });
  const hasUnvaluedLegacyHolding =
    legacySnapshot &&
    holdings.some(
      (holding) =>
        holding.valuation.status === "unvalued" ||
        holding.sourceMarketValue === null,
    );
  const total = hasUnvaluedLegacyHolding
    ? {
        amount: decimalAdd(
          ...holdings.flatMap((holding) =>
            holding.sourceMarketValue?.currency === snapshot.total.currency
              ? [holding.sourceMarketValue.amount]
              : [],
          ),
        ),
        currency: snapshot.total.currency,
      }
    : snapshot.total;
  const coverage =
    snapshot.coverage ??
    (source.kind === "binance"
      ? {
          status: "unknown" as const,
          products: [],
          unexplainedValue: null,
          excludedPositiveAccounts: [],
        }
      : undefined);
  const ignoredAssetKeys = normalizeIgnoredAssetKeys(
    source.ignoredAssetKeys,
  );
  const includedAssetKeys = normalizeIgnoredAssetKeys(
    source.includedAssetKeys,
  );
  return {
    ...source,
    kind: source.kind,
    investmentBookId: normalizedSourceBookId({ ...source, kind: source.kind }),
    ...(ignoredAssetKeys.length === 0 ? {} : { ignoredAssetKeys }),
    ...(includedAssetKeys.length === 0 ? {} : { includedAssetKeys }),
    ...(source.kind === "manual"
      ? { hasManualRecord: source.hasManualRecord !== false }
      : {}),
    snapshot: {
      ...snapshot,
      total,
      holdings,
      exchangeRates,
      ...(coverage === undefined ? {} : { coverage }),
    },
    sync: source.sync ? normalizeAssetSyncState(source.sync) : {
      status: "current",
      lastSuccessfulAt: snapshot.syncedAt,
      lastAttemptAt: snapshot.syncedAt,
      error: null,
    },
  };
}

export function migrateDailyObservation<T extends DailyAssetSnapshot>(
  observation: T,
): T {
  const total = {
    ...observation.total,
    HKD: observation.total.HKD ?? null,
  };
  const sources = observation.sources.map((source) => {
    const manual = source.kind === "manual";
    const complete = manual || source.complete;
    const status = manual
      ? "complete"
      : source.status === "expired"
        ? "expired"
        : complete
          ? "complete"
          : "incomplete";
    const normalizedTotal = {
      ...source.total,
      HKD: source.total.HKD ?? null,
    };
    const assetClassTotals = source.assetClassTotals === undefined
      ? source.kind === "longbridge"
        ? sourceTrendClassTotals(
            { kind: source.kind },
            { complete, status, total: normalizedTotal },
          )
        : undefined
      : {
          securities: {
            ...source.assetClassTotals.securities,
            total: {
              ...source.assetClassTotals.securities.total,
              HKD: source.assetClassTotals.securities.total.HKD ?? null,
            },
          },
          crypto: {
            ...source.assetClassTotals.crypto,
            total: {
              ...source.assetClassTotals.crypto.total,
              HKD: source.assetClassTotals.crypto.total.HKD ?? null,
            },
          },
        };
    return {
      ...source,
      complete,
      status,
      total: normalizedTotal,
      ...(assetClassTotals === undefined ? {} : { assetClassTotals }),
    };
  });
  const automatedSources = sources.filter((source) => source.kind !== "manual");
  const complete = automatedSources.length === 0
    ? sources.length > 0
    : automatedSources.every((source) => source.complete) &&
      total.USD !== null &&
      total.HKD !== null;
  const status = automatedSources.some((source) => source.status === "expired")
    ? "expired"
    : complete
      ? "complete"
      : "incomplete";
  return {
    ...observation,
    complete,
    status,
    total,
    exchangeRates: Array.isArray(observation.exchangeRates)
      ? observation.exchangeRates
      : [],
    sources,
  };
}

export function migrateManualAssetRecord(raw: unknown): ManualAssetRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("手工资产记录格式无效");
  }
  const record = raw as Partial<ManualAssetRecord>;
  if (
    typeof record.sourceId !== "string" ||
    typeof record.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.day) ||
    typeof record.amount !== "string" ||
    (record.currency !== "USD" &&
      record.currency !== "CNY" &&
      record.currency !== "HKD") ||
    typeof record.recordedAt !== "string" ||
    Number.isNaN(new Date(record.recordedAt).getTime())
  ) {
    throw new Error("手工资产记录格式无效");
  }
  return {
    sourceId: record.sourceId,
    day: record.day,
    amount: record.amount,
    currency: record.currency,
    recordedAt: record.recordedAt,
  };
}

export function uniqueManualAssetRecords(
  records: ManualAssetRecord[],
): ManualAssetRecord[] {
  return [...new Map(
    records.map((record) => [`${record.sourceId}:${record.day}`, record]),
  ).values()];
}

export function legacyManualAssetRecords(
  sources: AssetSourceSummary[],
): ManualAssetRecord[] {
  return sources.flatMap((source) =>
    source.kind === "manual" && source.hasManualRecord !== false
      ? [{
          sourceId: source.id,
          day: shanghaiDay(source.snapshot.syncedAt),
          amount: source.snapshot.total.amount,
          currency: source.snapshot.total.currency as ManualAssetRecord["currency"],
          recordedAt: source.snapshot.syncedAt,
        }]
      : [],
  );
}

export function parseLegacyDashboardStateSync(
  dashboardPath: string,
  legacyCardsPath: string,
): DashboardState {
  if (!existsSync(dashboardPath)) {
    if (!existsSync(legacyCardsPath)) {
      return {
        schemaVersion: DASHBOARD_SCHEMA_VERSION,
        assetCards: [],
        assetSources: [],
        manualAssetRecords: [],
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
        importedAssetSourceHistoryObservations: [],
      };
    }
    const assetCards = parseAssetCards(
      JSON.parse(readFileSync(legacyCardsPath, "utf8")),
    );
    if (assetCards === null) throw new Error("旧卡片数据格式无效");
    return {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      assetCards,
      assetSources: [],
      manualAssetRecords: [],
      dailyAssetSnapshots: [],
      dailyAssetTrendObservations: [],
      importedAssetSourceHistoryObservations: [],
    };
  }

  const value = JSON.parse(readFileSync(dashboardPath, "utf8")) as
    Partial<DashboardState> & { cards?: unknown };
  const assetCards = parseAssetCards(value.assetCards ?? value.cards);
  if (assetCards === null || !Array.isArray(value.assetSources)) {
    throw new Error(`Dashboard 数据文件格式无效: ${dashboardPath}`);
  }
  const assetSources = value.assetSources.map(migrateAssetSource);
  const sourceById = new Map(assetSources.map((source) => [source.id, source]));
  const manualAssetRecords = uniqueManualAssetRecords(
    Array.isArray(value.manualAssetRecords)
      ? value.manualAssetRecords
        .map(migrateManualAssetRecord)
        .filter((record) => sourceById.get(record.sourceId)?.kind === "manual")
      : legacyManualAssetRecords(assetSources),
  );
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    assetCards,
    assetSources,
    manualAssetRecords,
    dailyAssetSnapshots: Array.isArray(value.dailyAssetSnapshots)
      ? value.dailyAssetSnapshots.map(migrateDailyObservation)
      : [],
    dailyAssetTrendObservations: Array.isArray(value.dailyAssetTrendObservations)
      ? value.dailyAssetTrendObservations.map(migrateDailyObservation)
      : Array.isArray(value.dailyAssetSnapshots)
        ? value.dailyAssetSnapshots.map(migrateDailyObservation)
        : [],
    importedAssetSourceHistoryObservations:
      Array.isArray(value.importedAssetSourceHistoryObservations)
        ? value.importedAssetSourceHistoryObservations as ImportedAssetSourceHistoryObservation[]
        : [],
  };
}
