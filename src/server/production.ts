import { ObservedFormalSettlementRunner } from "@/server/formal-settlement-execution";
import { LocalFormalSettlementScheduler } from "@/server/formal-settlement-scheduler";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const sqlite = process.getBuiltinModule("node:sqlite");
if (sqlite === undefined) {
  throw new Error("当前 Node.js 运行时不支持 node:sqlite");
}
const { DatabaseSync } = sqlite;

import { decimalAdd, decimalCompare, decimalDivide } from "@/domain/decimal";
import {
  buildDailyAssetSnapshot,
  mergeDailyTrendObservation,
  shanghaiDay,
  sourceTrendClassTotals,
} from "@/domain/daily-asset-snapshots";
import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  assertManualAssetRecordNotFuture,
} from "@/domain/manual-asset-records";
import {
  normalizeIgnoredAssetKeys,
  updateEvmTokenPreferences,
} from "@/domain/evm-token-preferences";
import type {
  AppServices,
  Card,
} from "@/server/composition";
import type {
  AssetSourceSummary,
  AssetSourceLifecycle,
  AssetFullRefreshState,
  AssetSnapshot,
  AssetSourceConnections,
  AssetSources,
  CreateManualAssetSourceInput,
  BitAuthorizationResult,
  DailyAssetSourceSnapshot,
  BinanceAuthorizationResult,
  BitgetAuthorizationResult,
  EvmWatchAuthorizationResult,
  OkxAuthorizationResult,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
  DailyAssetSnapshots,
  ImportedAssetSourceHistoryObservation,
  FormalDailySettlement,
  FormalSettlementExecution,
  FormalSettlementExecutions,
  FormalDailySettlements,
  InvestmentCashflow,
  ManualAssetRecord,
  ManualAssetClass,
  ManualAssetRecordInput,
  ManualAssetRecords,
  AssetCardStore,
  Clock,
  OwnerAuth,
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  ExternalServiceConfiguration,
  SecretStore,
  LongbridgeAuthorizationResult,
} from "@/server/ports";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { parseAssetCards } from "@/server/asset-cards";
import { isMacOSKeychainCredentialReference } from "@/server/asset-sources/longbridge-keychain-sdk";
import {
  isLongbridgeUsOptionSymbol,
  LongbridgeOAuthState,
  KeychainLongbridgeOAuth,
  KeychainLongbridgeBenchmarkCandlestickReader,
  KeychainLongbridgeHoldingCandlestickReader,
  KeychainLongbridgeFormalSettlementCandleReader,
  KeychainLongbridgeSourceRefresher,
} from "@/server/asset-sources/longbridge";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import {
  MarketCloseFormalDailySettlement,
  ReadOnlyFormalSettlementSourceCapture,
} from "@/server/formal-daily-settlement";
import {
  CoinGeckoUsdtUsdPrices,
  ProductionBinanceReadOnly,
  ProductionBinanceSourceRefresher,
} from "@/server/asset-sources/binance";
import { RoutedAssetSourceRefresher } from "@/server/asset-sources/router";
import {
  ProductionOkxReadOnly,
  ProductionOkxSourceRefresher,
} from "@/server/asset-sources/okx";
import {
  ProductionBitgetReadOnly,
  ProductionBitgetSourceRefresher,
} from "@/server/asset-sources/bitget";
import {
  ProductionBitReadOnly,
  ProductionBitSourceRefresher,
} from "@/server/asset-sources/bit";
import {
  ProductionEvmWatchSourceRefresher,
  ProductionEvmWatchWallet,
} from "@/server/asset-sources/ethereum";
import { FileExternalServiceConfiguration } from "@/server/external-service-configuration";
import {
  atomicWritePrivateFile,
  hardenLocalDataPermissions,
  readPrivateFile,
} from "@/server/local-data-permissions";
import {
  CredentialFreeBusinessDataBackup,
  type BusinessDataState,
} from "@/server/business-data-backup";
import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

interface DashboardState {
  schemaVersion: 9;
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  manualAssetRecords: ManualAssetRecord[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  importedAssetSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
}

const DASHBOARD_SCHEMA_VERSION = 9 as const;
const SQLITE_SCHEMA_VERSION = 18;

type SourceConnectionKind =
  | "longbridge"
  | "binance"
  | "okx"
  | "bitget"
  | "bit"
  | "evm";
type SourceAuthorizationResult =
  | LongbridgeAuthorizationResult
  | BinanceAuthorizationResult
  | OkxAuthorizationResult
  | BitgetAuthorizationResult
  | BitAuthorizationResult
  | EvmWatchAuthorizationResult;

function connectedSourceKind(
  sourceKind: SourceConnectionKind,
  result: SourceAuthorizationResult,
): AssetSourceSummary["kind"] {
  if (sourceKind !== "evm") return sourceKind;
  if (!("chain" in result)) throw new Error("EVM 重新授权缺少链信息");
  return result.chain === "ethereum" ? "evm-watch-ethereum" : "evm-watch-bsc";
}

const SOURCE_CARD_DETAILS = {
  longbridge: {
    kind: "longbridge",
    title: "长桥资产",
    body: "只读证券账户",
  },
  binance: {
    kind: "binance",
    title: "Binance 资产",
    body: "投资产品明细、钱包守恒与覆盖状态",
  },
  okx: {
    kind: "okx",
    title: "OKX 资产",
    body: "现货、资金与 Earn 只读账户",
  },
  bitget: {
    kind: "bitget",
    title: "Bitget 资产",
    body: "现货、资金与 Earn 只读账户",
  },
  bit: {
    kind: "bit",
    title: "BIT / Matrixport 资产",
    body: "Wallet 与理财产品只读账户",
  },
} as const;

function buildConnectedSource(
  sourceKind: SourceConnectionKind,
  result: SourceAuthorizationResult,
  credentialReference: string,
): { source: AssetSourceSummary; card: Card } {
  const details = sourceKind === "evm"
    ? (() => {
        const evm = result as EvmWatchAuthorizationResult;
        return evm.chain === "ethereum"
          ? {
              kind: "evm-watch-ethereum",
              title: "Ethereum 观察钱包",
              body: "公开地址 ETH 与 ERC-20 只读来源",
            }
          : {
              kind: "evm-watch-bsc",
              title: "BNB Smart Chain 观察钱包",
              body: "公开地址 BNB 与 BEP-20 只读来源",
            };
      })()
    : SOURCE_CARD_DETAILS[sourceKind];
  const sourceId = randomUUID();
  return {
    source: {
      id: sourceId,
      kind: details.kind,
      label: result.account.label,
      accountId: result.account.id,
      permissions: result.permissions,
      credentialReference,
      snapshot: result.snapshot,
      sync: {
        status: "current",
        lastSuccessfulAt: result.snapshot.syncedAt,
        lastAttemptAt: result.snapshot.syncedAt,
        error: null,
      },
    },
    card: {
      id: randomUUID(),
      kind: "asset",
      title: details.title,
      body: details.body,
      sourceId,
      span: 1,
    },
  };
}

interface DashboardDatabase {
  listAssetCards(): Promise<Card[]>;
  replaceAssetCards(cards: Card[]): Promise<void>;
  listSources(): Promise<AssetSourceSummary[]>;
  replaceSources(sources: AssetSourceSummary[]): Promise<void>;
  updateSource(source: AssetSourceSummary): Promise<void>;
  listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]>;
  listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  >;
  createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean>;
  recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void>;
  setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void>;
  setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void>;
  setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void>;
  setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void>;
  createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void>;
  listManualAssetRecords(): Promise<ManualAssetRecord[]>;
  recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void>;
  deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void>;
  disconnectAssetSource(sourceId: string): Promise<string | null>;
  deleteAssetSourceData(sourceId: string): Promise<string | null>;
  connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<string | null>;
  connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
  connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void>;
}

function withoutSnapshotSource(
  snapshot: DailyAssetSnapshot,
  sourceId: string,
): DailyAssetSnapshot | null {
  const sources = snapshot.sources.filter((source) => source.sourceId !== sourceId);
  if (sources.length === 0) return null;
  const total = {
    USD: sources.some((source) => source.total.USD !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.USD ?? []))
      : null,
    CNY: sources.some((source) => source.total.CNY !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.CNY ?? []))
      : null,
    HKD: sources.some((source) => source.total.HKD !== null)
      ? decimalAdd(...sources.flatMap((source) => source.total.HKD ?? []))
      : null,
  };
  return {
    ...snapshot,
    sources,
    total,
    complete:
      sources.every((source) => source.complete) &&
      total.USD !== null &&
      total.HKD !== null,
  };
}

function manualDailySource(
  source: Pick<
    AssetSourceSummary,
    "id" | "kind" | "label" | "manualAssetClass"
  >,
  record: ManualAssetRecord,
): DailyAssetSourceSnapshot {
  const total = {
    USD: record.currency === "USD" ? record.amount : null,
    CNY: record.currency === "CNY" ? record.amount : null,
    HKD: record.currency === "HKD" ? record.amount : null,
  };
  const observation = {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt: record.recordedAt,
    complete: true,
    status: "complete",
    total,
  } satisfies DailyAssetSourceSnapshot;
  return {
    ...observation,
    assetClassTotals: sourceTrendClassTotals(source, observation),
  };
}

function latestManualAssetRecord(
  records: ManualAssetRecord[],
): ManualAssetRecord | null {
  return records.toSorted((left, right) => right.day.localeCompare(left.day))[0] ?? null;
}

function applyLatestManualAssetRecord(
  source: AssetSourceSummary,
  record: ManualAssetRecord | null,
  changedAt: string,
): AssetSourceSummary {
  return {
    ...source,
    hasManualRecord: record !== null,
    snapshot: {
      ...source.snapshot,
      total: record === null
        ? { amount: "0", currency: "CNY" }
        : { amount: record.amount, currency: record.currency },
      syncedAt: record?.recordedAt ?? changedAt,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: record?.recordedAt ?? changedAt,
      lastAttemptAt: changedAt,
      error: null,
      failedMode: null,
    },
  };
}

function mergeManualSourceObservation(
  previous: DailyAssetSnapshot,
  source: DailyAssetSourceSnapshot,
): DailyAssetSnapshot {
  const sources = [
    ...previous.sources.filter((item) => item.sourceId !== source.sourceId),
    source,
  ];
  const total = {
    USD: sources.some((item) => item.total.USD !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.USD ?? []))
      : null,
    CNY: sources.some((item) => item.total.CNY !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.CNY ?? []))
      : null,
    HKD: sources.some((item) => item.total.HKD !== null)
      ? decimalAdd(...sources.flatMap((item) => item.total.HKD ?? []))
      : null,
  };
  const complete =
    total.USD !== null &&
    total.HKD !== null &&
    sources.every((item) => item.complete);
  return {
    ...previous,
    sources,
    total,
    complete,
    status: sources.some((item) => item.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete",
  };
}

function manualOnlyTrendObservation(
  day: string,
  source: DailyAssetSourceSnapshot,
): DailyAssetTrendObservation {
  return {
    day,
    capturedAt: source.capturedAt,
    exchangeRates: [],
    complete: false,
    status: "incomplete",
    total: source.total,
    sources: [source],
  };
}

function migrateAssetSource(raw: unknown): AssetSourceSummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("资产来源数据格式无效");
  }
  const source = raw as AssetSourceSummary;
  if (
    typeof source.snapshot !== "object" ||
    source.snapshot === null ||
    !Array.isArray(source.snapshot.holdings)
  ) {
    throw new Error("资产来源快照格式无效");
  }
  const snapshot = source.snapshot as AssetSnapshot;
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

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function migrateDailyObservation<T extends DailyAssetSnapshot>(
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

function migrateManualAssetRecord(raw: unknown): ManualAssetRecord {
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

function uniqueManualAssetRecords(
  records: ManualAssetRecord[],
): ManualAssetRecord[] {
  return [...new Map(
    records.map((record) => [`${record.sourceId}:${record.day}`, record]),
  ).values()];
}

function legacyManualAssetRecords(
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

/** 普通 Dashboard 数据只保存不透明凭证引用，不保存凭证或密文。 */
export class FileDashboardDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly legacyCardsPath: string,
  ) {}

  private async load(): Promise<DashboardState> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      let assetCards: Card[] = [];
      try {
        const legacy = parseAssetCards(
          JSON.parse(await readPrivateFile(this.legacyCardsPath)),
        );
        if (legacy === null) throw new Error("旧卡片数据格式无效");
        assetCards = legacy;
      } catch (legacyError) {
        if (!isMissingFile(legacyError)) throw legacyError;
      }
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
    const value = JSON.parse(raw) as Partial<DashboardState> & {
      cards?: unknown;
    };
    const assetCards = parseAssetCards(value.assetCards ?? value.cards);
    if (
      assetCards === null ||
      !Array.isArray(value.assetSources)
    ) {
      throw new Error(`Dashboard 数据文件格式无效: ${this.filePath}`);
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

  private async write(state: DashboardState): Promise<void> {
    await atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(state, null, 2),
    );
  }

  private mutate<T>(operation: (state: DashboardState) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load();
      const result = operation(state);
      await this.write(state);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async listAssetCards(): Promise<Card[]> {
    await this.queue;
    return (await this.load()).assetCards;
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    await this.mutate((state) => {
      state.assetCards = cards;
    });
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    await this.queue;
    return (await this.load()).assetSources;
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    await this.mutate((state) => {
      state.assetSources = sources;
      const sourceIds = new Set(sources.map((source) => source.id));
      state.manualAssetRecords = state.manualAssetRecords.filter((record) =>
        sourceIds.has(record.sourceId),
      );
      state.importedAssetSourceHistoryObservations =
        state.importedAssetSourceHistoryObservations.filter((observation) =>
          sourceIds.has(observation.sourceId),
        );
    });
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    await this.mutate((state) => {
      const index = state.assetSources.findIndex((item) => item.id === source.id);
      if (index !== -1) state.assetSources[index] = source;
    });
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    await this.queue;
    return (await this.load()).dailyAssetSnapshots;
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    await this.queue;
    return (await this.load()).dailyAssetTrendObservations;
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    await this.queue;
    return (await this.load()).importedAssetSourceHistoryObservations;
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    await this.queue;
    return (await this.load()).manualAssetRecords.toSorted(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        right.day.localeCompare(left.day),
    );
  }

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.mutate((state) => {
      const existing = state.dailyAssetSnapshots.find(
        ({ day }) => day === snapshot.day,
      );
      if (existing) return false;
      state.dailyAssetSnapshots.push(snapshot);
      state.dailyAssetSnapshots.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
      state.dailyAssetTrendObservations.push(structuredClone(snapshot));
      state.dailyAssetTrendObservations.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
      return true;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    await this.mutate((state) => {
      const baselineIndex = state.dailyAssetSnapshots.findIndex(
        ({ day }) => day === snapshot.day,
      );
      if (baselineIndex === -1 && createBaseline) {
        state.dailyAssetSnapshots.push(structuredClone(snapshot));
        state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
      } else if (
        createBaseline &&
        state.dailyAssetSnapshots[baselineIndex].status === "expired"
      ) {
        state.dailyAssetSnapshots[baselineIndex] = structuredClone(snapshot);
      }
      const index = state.dailyAssetTrendObservations.findIndex(
        ({ day }) => day === snapshot.day,
      );
      if (index === -1) {
        state.dailyAssetTrendObservations.push(structuredClone(snapshot));
      } else {
        state.dailyAssetTrendObservations[index] = mergeDailyTrendObservation(
          state.dailyAssetTrendObservations[index],
          snapshot,
          !createBaseline,
        );
      }
      state.dailyAssetTrendObservations.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
    });
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    await this.mutate((state) => {
      if (!state.assetSources.some((source) => source.id === sourceId)) {
        throw new Error("资产来源不存在");
      }
      const card = state.assetCards.find(
        (item) => item.kind === "asset" && item.sourceId === sourceId,
      );
      if (!card || card.kind !== "asset") throw new Error("资产卡片不存在");
      card.hidden = hidden;
    });
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (displayName === null) delete source.displayName;
      else source.displayName = displayName;
    });
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产来源可以设置资产类别");
      }
      if (assetClass === null) delete source.manualAssetClass;
      else source.manualAssetClass = assetClass;
    });
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (ignoredAssetKeys.length === 0) delete source.ignoredAssetKeys;
      else source.ignoredAssetKeys = ignoredAssetKeys;
      if (includedAssetKeys.length === 0) delete source.includedAssetKeys;
      else source.includedAssetKeys = includedAssetKeys;
    });
  }

  private recordManualDailyObservation(
    state: DashboardState,
    source: AssetSourceSummary,
    record: ManualAssetRecord,
    capturedAt: string,
  ): void {
    const isCurrentDay = record.day === shanghaiDay(capturedAt);
    const currentObservation = isCurrentDay
      ? buildDailyAssetSnapshot(state.assetSources, capturedAt)
      : null;
    const manualSource = currentObservation?.sources.find(
      (item) => item.sourceId === source.id,
    ) ?? manualDailySource(source, record);
    const baselineIndex = state.dailyAssetSnapshots.findIndex(
      ({ day }) => day === record.day,
    );
    if (baselineIndex === -1 && currentObservation !== null) {
      state.dailyAssetSnapshots.push(structuredClone(currentObservation));
    }
    const trendIndex = state.dailyAssetTrendObservations.findIndex(
      ({ day }) => day === record.day,
    );
    if (trendIndex === -1 && currentObservation !== null) {
      state.dailyAssetTrendObservations.push(structuredClone(currentObservation));
    } else if (trendIndex === -1) {
      state.dailyAssetTrendObservations.push(
        manualOnlyTrendObservation(record.day, manualSource),
      );
    } else {
      state.dailyAssetTrendObservations[trendIndex] = mergeManualSourceObservation(
        state.dailyAssetTrendObservations[trendIndex],
        manualSource,
      );
    }
    state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
    state.dailyAssetTrendObservations.sort((left, right) =>
      left.day.localeCompare(right.day),
    );
  }

  private removeManualDailyObservation(
    state: DashboardState,
    sourceId: string,
    day: string,
  ): void {
    const remove = (snapshot: DailyAssetSnapshot): DailyAssetSnapshot | null =>
      withoutSnapshotSource(snapshot, sourceId);
    const baselineIndex = state.dailyAssetSnapshots.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (baselineIndex !== -1) {
      const next = remove(state.dailyAssetSnapshots[baselineIndex]);
      if (next === null) state.dailyAssetSnapshots.splice(baselineIndex, 1);
      else state.dailyAssetSnapshots[baselineIndex] = next;
    }
    const trendIndex = state.dailyAssetTrendObservations.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (trendIndex !== -1) {
      const next = remove(state.dailyAssetTrendObservations[trendIndex]);
      if (next === null) state.dailyAssetTrendObservations.splice(trendIndex, 1);
      else state.dailyAssetTrendObservations[trendIndex] = next;
    }
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const sourceId = randomUUID();
      state.assetSources.push({
        id: sourceId,
        kind: "manual",
        label: input.label,
        hasManualRecord: false,
        accountId: `manual:${sourceId}`,
        permissions: [],
        credentialReference: null,
        snapshot: {
          total: { amount: "0", currency: "CNY" },
          holdings: [],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      });
      state.assetCards.push({
        id: randomUUID(),
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      });
    });
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以编辑今日总额");
      }
      const record: ManualAssetRecord = {
        sourceId,
        ...input,
        recordedAt: capturedAt,
      };
      state.manualAssetRecords = [
        ...state.manualAssetRecords.filter(
          (item) => item.sourceId !== sourceId || item.day !== input.day,
        ),
        record,
      ];
      const latest = latestManualAssetRecord(
        state.manualAssetRecords.filter((item) => item.sourceId === sourceId),
      );
      const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
      state.assetSources = state.assetSources.map((item) =>
        item.id === sourceId ? updated : item,
      );
      this.recordManualDailyObservation(state, updated, record, capturedAt);
    });
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以删除");
      }
      const recordExists = state.manualAssetRecords.some(
        (record) => record.sourceId === sourceId && record.day === day,
      );
      if (!recordExists) throw new Error("指定日期没有手工资产记录");
      state.manualAssetRecords = state.manualAssetRecords.filter(
        (record) => record.sourceId !== sourceId || record.day !== day,
      );
      const latest = latestManualAssetRecord(
        state.manualAssetRecords.filter((record) => record.sourceId === sourceId),
      );
      state.assetSources = state.assetSources.map((item) =>
        item.id === sourceId
          ? applyLatestManualAssetRecord(item, latest, capturedAt)
          : item,
      );
      this.removeManualDailyObservation(state, sourceId, day);
    });
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind === "manual") {
        throw new Error("手工资产记录不支持断开");
      }
      source.lifecycle = "disconnected";
      return source.credentialReference;
    });
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      state.assetSources = state.assetSources.filter((item) => item.id !== sourceId);
      state.manualAssetRecords = state.manualAssetRecords.filter(
        (record) => record.sourceId !== sourceId,
      );
      state.assetCards = state.assetCards.filter(
        (card) => card.kind !== "asset" || card.sourceId !== sourceId,
      );
      state.dailyAssetSnapshots = state.dailyAssetSnapshots.flatMap((snapshot) => {
        const updated = withoutSnapshotSource(snapshot, sourceId);
        return updated ? [updated] : [];
      });
      state.dailyAssetTrendObservations = state.dailyAssetTrendObservations.flatMap(
        (snapshot) => {
          const updated = withoutSnapshotSource(snapshot, sourceId);
          return updated ? [updated] : [];
        },
      );
      state.importedAssetSourceHistoryObservations =
        state.importedAssetSourceHistoryObservations.filter(
          (observation) => observation.sourceId !== sourceId,
        );
      return source.credentialReference;
    });
  }

  async connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("longbridge", result, credentialReference, capturedAt);
  }

  async connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("binance", result, credentialReference, capturedAt);
  }

  async reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<string | null> {
    return this.mutate((state) => {
      const index = state.assetSources.findIndex(({ id }) => id === sourceId);
      const source = state.assetSources[index];
      const kind = connectedSourceKind(sourceKind, result);
      if (!source || source.kind !== kind) {
        throw new Error("资产来源不存在或类型不匹配");
      }
      if (source.accountId !== result.account.id) {
        throw new Error("新授权对应的账户与原来源不一致");
      }
      state.assetSources[index] = {
        ...source,
        label: result.account.label,
        accountId: result.account.id,
        permissions: result.permissions,
        credentialReference,
        snapshot: result.snapshot,
        lifecycle: "connected",
        sync: {
          status: "current",
          lastSuccessfulAt: result.snapshot.syncedAt,
          lastAttemptAt: result.snapshot.syncedAt,
          error: null,
        },
      };
      return source.credentialReference;
    });
  }

  async connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("okx", result, credentialReference, capturedAt);
  }

  async connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("bitget", result, credentialReference, capturedAt);
  }

  async connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("bit", result, credentialReference, capturedAt);
  }

  async connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("evm", result, credentialReference, capturedAt);
  }

  private async connectAssetSource(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const isFirstAutomaticSource = !state.assetSources.some(
        (source) => source.kind !== "manual",
      );
      const connected = buildConnectedSource(
        sourceKind,
        result,
        credentialReference,
      );
      state.assetSources.push(connected.source);
      state.assetCards.push(connected.card);
      const dailySnapshot = buildDailyAssetSnapshot(state.assetSources, capturedAt);
      if (isFirstAutomaticSource && dailySnapshot.complete) {
        const trendIndex = state.dailyAssetTrendObservations.findIndex(
          ({ day }) => day === dailySnapshot.day,
        );
        if (trendIndex === -1) {
          state.dailyAssetTrendObservations.push(structuredClone(dailySnapshot));
        } else {
          state.dailyAssetTrendObservations[trendIndex] = mergeDailyTrendObservation(
            state.dailyAssetTrendObservations[trendIndex],
            dailySnapshot,
            false,
          );
        }
        if (!state.dailyAssetSnapshots.some(({ day }) => day === dailySnapshot.day)) {
          state.dailyAssetSnapshots.push(structuredClone(dailySnapshot));
        }
        state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
        state.dailyAssetTrendObservations.sort((left, right) => left.day.localeCompare(right.day));
      }
    });
  }
}

type SqliteRow = Record<string, string | number | null>;

function parseLegacyDashboardStateSync(
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

/** SQLite 只保存业务数据与不透明凭证引用；秘密正文仍由 SecretStore 持有。 */
export class SqliteDashboardDatabase
  implements DashboardDatabase, InvestmentCashflowStore
{
  private database!: InstanceType<typeof DatabaseSync>;

  constructor(
    private readonly databasePath: string,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {
    try {
      this.database = new DatabaseSync(databasePath);
      chmodSync(databasePath, 0o600);
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.createSchema();
      this.initializeLegacyData();
      this.assertIntegrity();
      this.hardenDatabaseFiles();
    } catch (error) {
      try {
        this.database?.close();
      } catch {
        // 保留原始启动错误。
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `SQLite 业务数据初始化失败，已停止启动；请保留 ${databasePath} 和旧 JSON 后恢复: ${detail}`,
        { cause: error },
      );
    }
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_sources (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        display_name TEXT,
        account_id TEXT NOT NULL,
        permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
        credential_reference TEXT,
        ignored_asset_keys_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(ignored_asset_keys_json)),
        included_asset_keys_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(included_asset_keys_json)),
        has_manual_record INTEGER NOT NULL DEFAULT 1
          CHECK (has_manual_record IN (0, 1)),
        manual_asset_class TEXT
          CHECK (
            manual_asset_class IS NULL OR
            manual_asset_class IN ('securities', 'crypto', 'cash', 'other')
          ),
        lifecycle TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('connected', 'disconnected'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_snapshots (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        total_amount TEXT NOT NULL,
        total_currency TEXT NOT NULL,
        holdings_json TEXT NOT NULL CHECK (json_valid(holdings_json)),
        unrecognized_evm_tokens_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(unrecognized_evm_tokens_json)),
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json)),
        coverage_json TEXT CHECK (coverage_json IS NULL OR json_valid(coverage_json)),
        synced_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_sync_states (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('current', 'expired')),
        last_successful_at TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        error TEXT,
        failed_mode TEXT CHECK (failed_mode IS NULL OR failed_mode IN ('all', 'prices', 'holdings')),
        diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
        recent_attempts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recent_attempts_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS manual_asset_records (
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY', 'HKD')),
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (source_id, day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_cards (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_id TEXT,
        hidden INTEGER CHECK (hidden IS NULL OR hidden IN (0, 1)),
        span INTEGER NOT NULL CHECK (span IN (1, 2, 3)),
        starts_new_row INTEGER CHECK (starts_new_row IS NULL OR starts_new_row IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_snapshots (
        day TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_source_snapshots (
        day TEXT NOT NULL REFERENCES daily_asset_snapshots(day) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        asset_class_totals_json TEXT
          CHECK (
            asset_class_totals_json IS NULL OR
            json_valid(asset_class_totals_json)
          ),
        PRIMARY KEY (day, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_trend_observations (
        day TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_source_trend_observations (
        day TEXT NOT NULL REFERENCES daily_asset_trend_observations(day) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        asset_class_totals_json TEXT
          CHECK (
            asset_class_totals_json IS NULL OR
            json_valid(asset_class_totals_json)
          ),
        PRIMARY KEY (day, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS imported_asset_source_history_observations (
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        PRIMARY KEY (source_id, day)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_settlement_execution (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        started_at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlements (
        anchor_key TEXT PRIMARY KEY,
        anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('securities-close', 'crypto-cutoff')),
        anchor_market TEXT,
        anchor_trading_day TEXT NOT NULL,
        scheduled_close_at TEXT NOT NULL,
        captured_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'missed')),
        diagnostic TEXT,
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlement_sources (
        anchor_key TEXT NOT NULL
          REFERENCES formal_daily_settlements(anchor_key) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'missed')),
        diagnostic TEXT,
        total_usd TEXT,
        total_cny TEXT,
        total_hkd TEXT,
        PRIMARY KEY (anchor_key, source_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS formal_daily_settlement_holdings (
        anchor_key TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_identity TEXT NOT NULL,
        source_asset TEXT,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity TEXT NOT NULL,
        asset_class TEXT NOT NULL CHECK (asset_class IN ('securities', 'crypto', 'cash')),
        price_amount TEXT,
        price_currency TEXT,
        price_basis TEXT NOT NULL
          CHECK (price_basis IN ('official-close', 'capture-time', 'unavailable')),
        price_observed_at TEXT,
        market TEXT,
        market_trading_day TEXT,
        market_value TEXT,
        diagnostic TEXT,
        PRIMARY KEY (anchor_key, source_id, source_identity),
        FOREIGN KEY (anchor_key, source_id)
          REFERENCES formal_daily_settlement_sources(anchor_key, source_id)
          ON DELETE CASCADE
      ) STRICT;
    `);
    let schemaVersion = this.metadata("schema_version");
    if (schemaVersion === null) {
      this.createInvestmentCashflowSchema();
      this.database
        .prepare("INSERT INTO schema_metadata (key, value) VALUES (?, ?)")
        .run("schema_version", String(SQLITE_SCHEMA_VERSION));
      return;
    }
    if (schemaVersion === "1") {
      this.migrateSchemaVersionOne();
      schemaVersion = "2";
    }
    if (schemaVersion === "2") {
      this.migrateSchemaVersionTwo();
      schemaVersion = "3";
    }
    if (schemaVersion === "3") {
      this.migrateSchemaVersionThree();
      schemaVersion = "4";
    }
    if (schemaVersion === "4") {
      this.migrateSchemaVersionFour();
      schemaVersion = "5";
    }
    if (schemaVersion === "5") {
      this.migrateSchemaVersionFive();
      schemaVersion = "6";
    }
    if (schemaVersion === "6") {
      this.migrateSchemaVersionSix();
      schemaVersion = "7";
    }
    if (schemaVersion === "7") {
      this.migrateSchemaVersionSeven();
      schemaVersion = "8";
    }
    if (schemaVersion === "8") {
      this.migrateSchemaVersionEight();
      schemaVersion = "9";
    }
    if (schemaVersion === "9") {
      this.migrateSchemaVersionNine();
      schemaVersion = "10";
    }
    if (schemaVersion === "10") {
      this.migrateSchemaVersionTen();
      schemaVersion = "11";
    }
    if (schemaVersion === "11") {
      this.migrateSchemaVersionEleven();
      schemaVersion = "12";
    }
    if (schemaVersion === "12") {
      this.migrateSchemaVersionTwelve();
      schemaVersion = "13";
    }
    if (schemaVersion === "13") {
      this.migrateSchemaVersionThirteen();
      schemaVersion = "14";
    }
    if (schemaVersion === "14") {
      this.migrateSchemaVersionFourteen();
      schemaVersion = "15";
    }
    if (schemaVersion === "15") {
      this.migrateSchemaVersionFifteen();
      schemaVersion = "16";
    }
    if (schemaVersion === "16") {
      this.migrateSchemaVersionSixteen();
      schemaVersion = "17";
    }
    if (schemaVersion === "17") {
      this.migrateSchemaVersionSeventeen();
      schemaVersion = "18";
    }
    if (schemaVersion !== String(SQLITE_SCHEMA_VERSION)) {
      throw new Error(`不支持的 SQLite schema 版本: ${schemaVersion}`);
    }
  }

  private createInvestmentCashflowSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS investment_cashflows (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (
          kind IN ('initial-investment', 'external-deposit', 'external-withdrawal')
        ),
        occurred_at TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY', 'HKD')),
        note TEXT,
        amount_usd TEXT,
        amount_cny TEXT,
        amount_hkd TEXT,
        exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS investment_cashflows_one_initial
        ON investment_cashflows(kind)
        WHERE kind = 'initial-investment';
    `);
  }

  private migrateSchemaVersionOne(): void {
    this.transaction(() => {
      this.database.exec(`
        CREATE TEMP TABLE credential_references_before_migration AS
        SELECT id, credential_reference FROM asset_sources;
        ALTER TABLE asset_sources DROP COLUMN credential_reference;
        ALTER TABLE asset_sources ADD COLUMN credential_reference TEXT;
        UPDATE asset_sources
        SET credential_reference = (
          SELECT credential_reference
          FROM credential_references_before_migration
          WHERE credential_references_before_migration.id = asset_sources.id
        );
        DROP TABLE credential_references_before_migration;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("2", "schema_version");
    });
  }

  private migrateSchemaVersionTwo(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_source_snapshots
        ADD COLUMN coverage_json TEXT
        CHECK (coverage_json IS NULL OR json_valid(coverage_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("3", "schema_version");
    });
  }

  private migrateSchemaVersionThree(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_sources
        ADD COLUMN display_name TEXT;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("4", "schema_version");
    });
  }

  private migrateSchemaVersionFour(): void {
    this.transaction(() => {
      this.database.exec(`
        INSERT OR IGNORE INTO daily_asset_trend_observations (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        )
        SELECT day, captured_at, complete,
          CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END,
          total_usd, total_cny, NULL, '[]'
        FROM daily_asset_snapshots;
        INSERT OR IGNORE INTO daily_asset_source_trend_observations (
          day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd
        )
        SELECT day, source_id, label, kind, captured_at, complete,
          CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END,
          total_usd, total_cny, NULL
        FROM daily_asset_source_snapshots;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("5", "schema_version");
    });
  }

  private migrateSchemaVersionFive(): void {
    this.transaction(() => {
      const tables = [
        "daily_asset_snapshots",
        "daily_asset_source_snapshots",
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
      ] as const;
      for (const table of tables) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "status")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN status TEXT NOT NULL DEFAULT 'incomplete'
            CHECK (status IN ('complete', 'incomplete', 'expired'));
          `);
        }
      }
      this.database.exec(`
        UPDATE daily_asset_snapshots
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_source_snapshots
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_trend_observations
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
        UPDATE daily_asset_source_trend_observations
        SET status = CASE WHEN complete = 1 THEN 'complete' ELSE 'incomplete' END;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("6", "schema_version");
    });
  }

  private migrateSchemaVersionSix(): void {
    this.transaction(() => {
      const tables = [
        "daily_asset_snapshots",
        "daily_asset_source_snapshots",
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
      ] as const;
      for (const table of tables) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "total_hkd")) {
          this.database.exec(`ALTER TABLE ${table} ADD COLUMN total_hkd TEXT;`);
        }
      }
      for (const table of [
        "daily_asset_snapshots",
        "daily_asset_trend_observations",
      ] as const) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "exchange_rates_json")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN exchange_rates_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(exchange_rates_json));
          `);
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("7", "schema_version");
    });
  }

  private migrateSchemaVersionSeven(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_sources
        ADD COLUMN ignored_asset_keys_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(ignored_asset_keys_json));
        ALTER TABLE asset_sources
        ADD COLUMN included_asset_keys_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(included_asset_keys_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("8", "schema_version");
    });
  }

  private migrateSchemaVersionEight(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "has_manual_record")) {
        this.database.exec(`
          ALTER TABLE asset_sources
          ADD COLUMN has_manual_record INTEGER NOT NULL DEFAULT 1
            CHECK (has_manual_record IN (0, 1));
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("9", "schema_version");
    });
  }

  private migrateSchemaVersionNine(): void {
    this.transaction(() => {
      const rows = this.database
        .prepare(`
          SELECT sources.id, snapshots.total_amount, snapshots.total_currency,
            snapshots.synced_at
          FROM asset_sources AS sources
          JOIN asset_source_snapshots AS snapshots ON snapshots.source_id = sources.id
          WHERE sources.kind = 'manual' AND sources.has_manual_record = 1
        `)
        .all() as SqliteRow[];
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO manual_asset_records (
          source_id, day, amount, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.id as string,
          shanghaiDay(row.synced_at as string),
          row.total_amount as string,
          row.total_currency as string,
          row.synced_at as string,
        );
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("10", "schema_version");
    });
  }

  private migrateSchemaVersionTen(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "manual_asset_class")) {
        this.database.exec(`
          ALTER TABLE asset_sources
          ADD COLUMN manual_asset_class TEXT
            CHECK (
              manual_asset_class IS NULL OR
              manual_asset_class IN ('securities', 'crypto', 'cash', 'other')
            );
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("11", "schema_version");
    });
  }

  private migrateSchemaVersionEleven(): void {
    this.transaction(() => {
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("12", "schema_version");
    });
  }

  private migrateSchemaVersionTwelve(): void {
    this.transaction(() => {
      this.createInvestmentCashflowSchema();
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("13", "schema_version");
    });
  }

  private migrateSchemaVersionThirteen(): void {
    this.transaction(() => {
      const columns = this.database
        .prepare("PRAGMA table_info(asset_source_snapshots)")
        .all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "unrecognized_evm_tokens_json")) {
        this.database.exec(`
          ALTER TABLE asset_source_snapshots
          ADD COLUMN unrecognized_evm_tokens_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(unrecognized_evm_tokens_json));
        `);
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("14", "schema_version");
    });
  }

  private migrateSchemaVersionFourteen(): void {
    this.transaction(() => {
      for (const table of [
        "daily_asset_source_snapshots",
        "daily_asset_source_trend_observations",
      ] as const) {
        const columns = this.database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "asset_class_totals_json")) {
          this.database.exec(`
            ALTER TABLE ${table}
            ADD COLUMN asset_class_totals_json TEXT
              CHECK (
                asset_class_totals_json IS NULL OR
                json_valid(asset_class_totals_json)
              );
          `);
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("15", "schema_version");
    });
  }

  private migrateSchemaVersionFifteen(): void {
    this.transaction(() => {
      const manualClasses = new Map(
        (this.database
          .prepare(
            "SELECT id, manual_asset_class FROM asset_sources WHERE kind = 'manual'",
          )
          .all() as Array<SqliteRow>)
          .map((source) => [
            source.id as string,
            source.manual_asset_class as ManualAssetClass | null,
          ]),
      );

      for (const table of [
        "daily_asset_source_snapshots",
        "daily_asset_source_trend_observations",
      ] as const) {
        const rows = this.database
          .prepare(`SELECT * FROM ${table}`)
          .all() as Array<SqliteRow>;
        const updateTable = this.database.prepare(`
          UPDATE ${table}
          SET asset_class_totals_json = ?
          WHERE day = ? AND source_id = ?
        `);
        for (const row of rows) {
          const manualAssetClass = manualClasses.get(row.source_id as string);
          const source = {
            kind: row.kind as AssetSourceSummary["kind"],
            ...(manualAssetClass === null || manualAssetClass === undefined
              ? {}
              : { manualAssetClass }),
          };
          const observation = {
            sourceId: row.source_id as string,
            label: row.label as string,
            kind: row.kind as AssetSourceSummary["kind"],
            capturedAt: row.captured_at as string,
            complete: row.complete === 1,
            status: row.status as DailyAssetSourceSnapshot["status"],
            total: {
              USD: row.total_usd as string | null,
              CNY: row.total_cny as string | null,
              HKD: row.total_hkd as string | null,
            },
          } satisfies DailyAssetSourceSnapshot;
          updateTable.run(
            JSON.stringify(sourceTrendClassTotals(source, observation)),
            row.day,
            row.source_id,
          );
        }
      }
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("16", "schema_version");
    });
  }

  private migrateSchemaVersionSixteen(): void {
    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS imported_asset_source_history_observations (
          source_id TEXT NOT NULL REFERENCES asset_sources(id) ON DELETE CASCADE,
          day TEXT NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
          status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'expired')),
          total_usd TEXT,
          total_cny TEXT,
          total_hkd TEXT,
          PRIMARY KEY (source_id, day)
        ) STRICT;
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("17", "schema_version");
    });
  }

  private migrateSchemaVersionSeventeen(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE asset_source_sync_states ADD COLUMN diagnostic_json TEXT
          CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json));
        ALTER TABLE asset_source_sync_states ADD COLUMN recent_attempts_json TEXT
          NOT NULL DEFAULT '[]' CHECK (json_valid(recent_attempts_json));
      `);
      this.database
        .prepare("UPDATE schema_metadata SET value = ? WHERE key = ?")
        .run("18", "schema_version");
    });
  }

  private initializeLegacyData(): void {
    if (this.metadata("json_import_complete") === "1") return;
    const state = parseLegacyDashboardStateSync(
      this.legacyDashboardPath,
      this.legacyCardsPath,
    );
    this.transaction(() => {
      this.replaceState(state);
      this.backupLegacyDashboard();
      this.database
        .prepare(
          "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
        )
        .run("json_import_complete", "1");
    });
  }

  private backupLegacyDashboard(): void {
    if (!existsSync(this.legacyDashboardPath)) return;
    const backupPath = `${this.legacyDashboardPath}.migration-backup`;
    const source = readFileSync(this.legacyDashboardPath);
    if (existsSync(backupPath)) {
      if (!source.equals(readFileSync(backupPath))) {
        throw new Error(`迁移备份与旧 Dashboard 不一致: ${backupPath}`);
      }
    } else {
      copyFileSync(this.legacyDashboardPath, backupPath);
    }
    chmodSync(backupPath, 0o600);
  }

  private metadata(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM schema_metadata WHERE key = ?")
      .get(key) as SqliteRow | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  async readAssetFullRefreshState(): Promise<{
    attemptedAt: string | null;
    inProgressAt: string | null;
  }> {
    return {
      attemptedAt: this.metadata("asset_full_refresh_attempted_at"),
      inProgressAt: this.metadata("asset_full_refresh_in_progress_at"),
    };
  }

  async startAssetFullRefresh(attemptedAt: string): Promise<void> {
    this.transaction(() => {
      const write = this.database.prepare(
        "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
      );
      write.run("asset_full_refresh_attempted_at", attemptedAt);
      write.run("asset_full_refresh_in_progress_at", attemptedAt);
    });
  }

  async initializeAssetFullRefresh(attemptedAt: string): Promise<boolean> {
    return this.transaction(() =>
      this.database
        .prepare(
          "INSERT OR IGNORE INTO schema_metadata (key, value) VALUES (?, ?)",
        )
        .run("asset_full_refresh_attempted_at", attemptedAt).changes > 0,
    );
  }

  async claimAssetFullRefresh(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    return this.transaction(() => {
      const previousAttemptedAt = this.metadata(
        "asset_full_refresh_attempted_at",
      );
      const inProgressAt = this.metadata(
        "asset_full_refresh_in_progress_at",
      );
      const now = Date.parse(input.attemptedAt);
      const inProgress = inProgressAt === null ? Number.NaN : Date.parse(inProgressAt);
      const inProgressIsCurrent =
        Number.isFinite(inProgress) &&
        Number.isFinite(now) &&
        now - inProgress < input.staleAfterMs;
      if (inProgressAt !== null && inProgressIsCurrent) {
        return "in-progress";
      }

      const previous = previousAttemptedAt === null
        ? Number.NaN
        : Date.parse(previousAttemptedAt);
      if (
        !input.force &&
        Number.isFinite(previous) &&
        Number.isFinite(now) &&
        now - previous < input.intervalMs
      ) {
        return "not-due";
      }

      const write = this.database.prepare(
        "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
      );
      write.run("asset_full_refresh_attempted_at", input.attemptedAt);
      write.run("asset_full_refresh_in_progress_at", input.attemptedAt);
      return "claimed";
    });
  }

  async finishAssetFullRefresh(attemptedAt?: string): Promise<void> {
    this.transaction(() => {
      if (attemptedAt === undefined) {
        this.database
          .prepare("DELETE FROM schema_metadata WHERE key = ?")
          .run("asset_full_refresh_in_progress_at");
        return;
      }
      this.database
        .prepare("DELETE FROM schema_metadata WHERE key = ? AND value = ?")
        .run("asset_full_refresh_in_progress_at", attemptedAt);
    });
  }

  async clearAssetFullRefresh(): Promise<void> {
    this.transaction(() => {
      const remove = this.database.prepare(
        "DELETE FROM schema_metadata WHERE key IN (?, ?)",
      );
      remove.run(
        "asset_full_refresh_attempted_at",
        "asset_full_refresh_in_progress_at",
      );
    });
  }

  private assertIntegrity(): void {
    const result = this.database.prepare("PRAGMA quick_check").get() as
      | SqliteRow
      | undefined;
    if (result === undefined || !Object.values(result).includes("ok")) {
      throw new Error("SQLite 完整性检查失败");
    }
    const foreignKeyViolation = this.database
      .prepare("PRAGMA foreign_key_check")
      .get();
    if (foreignKeyViolation !== undefined) {
      throw new Error("SQLite 外键完整性检查失败");
    }
  }

  private hardenDatabaseFiles(): void {
    for (const filePath of [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
    ]) {
      if (existsSync(/* turbopackIgnore: true */ filePath)) {
        chmodSync(/* turbopackIgnore: true */ filePath, 0o600);
      }
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      this.hardenDatabaseFiles();
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // 优先抛出导致事务失败的原始错误。
      }
      throw error;
    }
  }

  private replaceState(state: DashboardState | BusinessDataState): void {
    this.database.exec(`
      DELETE FROM investment_cashflows;
      DELETE FROM imported_asset_source_history_observations;
      DELETE FROM daily_asset_source_trend_observations;
      DELETE FROM daily_asset_trend_observations;
      DELETE FROM daily_asset_source_snapshots;
      DELETE FROM daily_asset_snapshots;
      DELETE FROM formal_daily_settlements;
      DELETE FROM asset_cards;
      DELETE FROM asset_source_snapshots;
      DELETE FROM asset_source_sync_states;
      DELETE FROM asset_sources;
    `);
    state.assetSources.forEach((source, position) =>
      this.insertSource(source, position),
    );
    state.assetCards.forEach((card, position) => this.insertCard(card, position));
    state.dailyAssetSnapshots.forEach((snapshot) =>
      this.insertDailyBaseline(migrateDailyObservation(snapshot)),
    );
    state.dailyAssetTrendObservations.forEach((observation) =>
      this.upsertDailyTrendObservation(migrateDailyObservation(observation)),
    );
    const importedHistory = "importedAssetSourceHistoryObservations" in state
      ? state.importedAssetSourceHistoryObservations
      : [];
    importedHistory.forEach((observation) =>
      this.insertImportedSourceHistoryObservation(observation),
    );
    const cashflows = "investmentCashflows" in state
      ? (state as { investmentCashflows: InvestmentCashflow[] })
        .investmentCashflows
      : [];
    cashflows.forEach((cashflow) => this.insertInvestmentCashflow(cashflow));
    const manualRecords = "manualAssetRecords" in state
      ? state.manualAssetRecords
      : [];
    for (const record of manualRecords) {
      this.database.prepare(`
        INSERT INTO manual_asset_records (source_id, day, amount, currency, recorded_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.sourceId, record.day, record.amount, record.currency, record.recordedAt);
    }
    const formalSettlements = "formalDailySettlements" in state
      ? state.formalDailySettlements
      : [];
    for (const settlement of formalSettlements) {
      if (!this.insertFormalDailySettlement(settlement)) throw new Error("正式日结锚点重复");
    }
  }

  private insertSource(source: AssetSourceSummary, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, ignored_asset_keys_json, included_asset_keys_json,
          has_manual_record, manual_asset_class, lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        position,
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
      );
    this.upsertSourceDetails(source);
  }

  private upsertSourceDetails(source: AssetSourceSummary): void {
    const sync = normalizeAssetSyncState(source.sync);
    this.database
      .prepare(`
        UPDATE asset_sources
        SET has_manual_record = ?
        WHERE id = ?
      `)
      .run(
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.id,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_snapshots (
          source_id, total_amount, total_currency, holdings_json,
          unrecognized_evm_tokens_json, exchange_rates_json, coverage_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.snapshot.total.amount,
        source.snapshot.total.currency,
        JSON.stringify(source.snapshot.holdings),
        JSON.stringify(source.snapshot.unrecognizedEvmTokens ?? []),
        JSON.stringify(source.snapshot.exchangeRates),
        source.snapshot.coverage === undefined
          ? null
          : JSON.stringify(source.snapshot.coverage),
        source.snapshot.syncedAt,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_sync_states (
          source_id, status, last_successful_at, last_attempt_at, error, failed_mode,
          diagnostic_json, recent_attempts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.sync.status,
        source.sync.lastSuccessfulAt,
        source.sync.lastAttemptAt,
        source.sync.error,
        source.sync.failedMode ?? null,
        sync.diagnostic === undefined || sync.diagnostic === null
          ? null : JSON.stringify(sync.diagnostic),
        JSON.stringify(sync.recentAttempts ?? []),
      );
  }

  private insertCard(card: Card, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_cards (
          id, position, title, body, source_id, hidden, span, starts_new_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        card.id,
        position,
        card.title,
        card.body,
        card.sourceId ?? null,
        card.hidden === undefined ? null : Number(card.hidden),
        card.span,
        card.startsNewRow === undefined ? null : Number(card.startsNewRow),
      );
  }

  private insertInvestmentCashflow(cashflow: InvestmentCashflow): void {
    this.database
      .prepare(`
        INSERT INTO investment_cashflows (
          id, kind, occurred_at, amount, currency, note,
          amount_usd, amount_cny, amount_hkd, exchange_rates_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        cashflow.id,
        cashflow.kind,
        cashflow.occurredAt,
        cashflow.amount,
        cashflow.currency,
        cashflow.note,
        cashflow.amounts.USD,
        cashflow.amounts.CNY,
        cashflow.amounts.HKD,
        JSON.stringify(cashflow.exchangeRates),
        cashflow.createdAt,
        cashflow.updatedAt,
      );
  }

  private insertDailyBaseline(snapshot: DailyAssetSnapshot): boolean {
    const inserted = this.database
      .prepare(`
        INSERT OR IGNORE INTO daily_asset_snapshots (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      ).changes > 0;
    if (!inserted) return false;
    this.insertDailyBaselineSources(snapshot);
    return true;
  }

  private insertDailyBaselineSources(snapshot: DailyAssetSnapshot): void {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO daily_asset_source_snapshots (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
  }

  private replaceExpiredDailyBaseline(snapshot: DailyAssetSnapshot): void {
    this.database
      .prepare(`
        UPDATE daily_asset_snapshots
        SET captured_at = ?, complete = ?, status = ?, total_usd = ?, total_cny = ?,
          total_hkd = ?, exchange_rates_json = ?
        WHERE day = ?
      `)
      .run(
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
        snapshot.day,
      );
    this.database
      .prepare("DELETE FROM daily_asset_source_snapshots WHERE day = ?")
      .run(snapshot.day);
    this.insertDailyBaselineSources(snapshot);
  }

  private upsertDailyTrendObservation(
    snapshot: DailyAssetTrendObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO daily_asset_trend_observations (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          exchange_rates_json = excluded.exchange_rates_json
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      );
    const statement = this.database.prepare(`
      INSERT INTO daily_asset_source_trend_observations (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, source_id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        captured_at = excluded.captured_at,
        complete = excluded.complete,
        status = excluded.status,
        total_usd = excluded.total_usd,
        total_cny = excluded.total_cny,
        total_hkd = excluded.total_hkd,
        asset_class_totals_json = excluded.asset_class_totals_json
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
    this.recalculateDailyTrendObservation(snapshot.day);
  }

  private upsertDailySourceObservation(
    table:
      | "daily_asset_source_snapshots"
      | "daily_asset_source_trend_observations",
    day: string,
    source: DailyAssetSourceSnapshot,
  ): void {
    this.database
      .prepare(`
        INSERT INTO ${table} (
          day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, source_id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          asset_class_totals_json = excluded.asset_class_totals_json
      `)
      .run(
        day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
  }

  private insertImportedSourceHistoryObservation(
    observation: ImportedAssetSourceHistoryObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO imported_asset_source_history_observations (
          source_id, day, label, kind, captured_at, complete, status,
          total_usd, total_cny, total_hkd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        observation.sourceId,
        observation.day,
        observation.label,
        observation.kind,
        observation.capturedAt,
        Number(observation.complete),
        observation.status ?? (observation.complete ? "complete" : "incomplete"),
        observation.total.USD,
        observation.total.CNY,
        observation.total.HKD ?? null,
      );
  }

  /**
   * 手工记录是按上海自然日覆盖写入：同一来源当天只有一条，编辑会替换该来源的日值，
   * 而不会覆盖同日外部来源的观测。
   */
  private recordManualDailyObservation(
    source: AssetSourceSummary,
    record: ManualAssetRecord,
    capturedAt: string,
  ): void {
    const isCurrentDay = record.day === shanghaiDay(capturedAt);
    const currentObservation = isCurrentDay
      ? buildDailyAssetSnapshot(this.listSourcesSync(), capturedAt)
      : null;
    const manualSource = currentObservation?.sources.find(
      (item) => item.sourceId === source.id,
    ) ?? manualDailySource(source, record);

    const hasBaseline = this.database
      .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasBaseline && currentObservation !== null) {
      this.insertDailyBaseline(currentObservation);
    }

    const hasTrend = this.database
      .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasTrend && currentObservation !== null) {
      this.upsertDailyTrendObservation(currentObservation);
    } else if (!hasTrend) {
      this.database
        .prepare(`
          INSERT INTO daily_asset_trend_observations (
            day, captured_at, complete, status, total_usd, total_cny, total_hkd,
            exchange_rates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.day,
          manualSource.capturedAt,
          Number(manualSource.complete),
          manualSource.status ?? "incomplete",
          manualSource.total.USD,
          manualSource.total.CNY,
          manualSource.total.HKD ?? null,
          "[]",
        );
      this.upsertDailySourceObservation(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
    } else {
      this.upsertDailySourceObservation(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
      this.recalculateDailyTrendObservation(record.day);
    }
  }

  private recalculateDailySnapshot(
    day: string,
    tables: {
      snapshot: "daily_asset_snapshots" | "daily_asset_trend_observations";
      source: "daily_asset_source_snapshots" | "daily_asset_source_trend_observations";
    },
  ): void {
    const sources = this.dailySourceRows(day, tables.source);
    if (sources.length === 0) {
      this.database.prepare(`DELETE FROM ${tables.snapshot} WHERE day = ?`).run(day);
      return;
    }
    const totals = (column: "total_usd" | "total_cny" | "total_hkd") => {
      const values = sources.flatMap((source) =>
        typeof source[column] === "string" ? [source[column]] : [],
      );
      return values.length > 0 ? decimalAdd(...values) : null;
    };
    const totalUsd = totals("total_usd");
    const complete =
      totalUsd !== null &&
      totals("total_hkd") !== null &&
      sources.every((source) => source.complete === 1);
    const status = sources.some((source) => source.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete";
    this.database
      .prepare(`
        UPDATE ${tables.snapshot}
        SET complete = ?, status = ?, total_usd = ?, total_cny = ?, total_hkd = ?
        WHERE day = ?
      `)
      .run(
        Number(complete),
        status,
        totalUsd,
        totals("total_cny"),
        totals("total_hkd"),
        day,
      );
  }

  private recalculateDailyTrendObservation(day: string): void {
    this.recalculateDailySnapshot(day, {
      snapshot: "daily_asset_trend_observations",
      source: "daily_asset_source_trend_observations",
    });
  }

  private dailySourceRows(
    day: string,
    table = "daily_asset_source_snapshots",
  ): SqliteRow[] {
    return this.database
      .prepare(`
        SELECT source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        FROM ${table}
        WHERE day = ?
        ORDER BY rowid
      `)
      .all(day) as SqliteRow[];
  }

  private compactPositions(table: "asset_sources" | "asset_cards"): void {
    const rows = this.database
      .prepare(`SELECT id, position FROM ${table} ORDER BY position`)
      .all() as SqliteRow[];
    const update = this.database.prepare(
      `UPDATE ${table} SET position = ? WHERE id = ?`,
    );
    rows.forEach((row, position) => {
      if (row.position !== position) update.run(position, row.id as string);
    });
  }

  private listSourcesSync(): AssetSourceSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM asset_sources ORDER BY position")
      .all() as SqliteRow[];
    const snapshotStatement = this.database.prepare(
      "SELECT * FROM asset_source_snapshots WHERE source_id = ?",
    );
    const syncStatement = this.database.prepare(
      "SELECT * FROM asset_source_sync_states WHERE source_id = ?",
    );
    return rows.map((row) => {
      const snapshot = snapshotStatement.get(row.id as string) as SqliteRow;
      const sync = syncStatement.get(row.id as string) as SqliteRow;
      const unrecognizedEvmTokens = JSON.parse(
        (snapshot.unrecognized_evm_tokens_json as string | null) ?? "[]",
      );
      return migrateAssetSource({
        id: row.id as string,
        kind: row.kind as string,
        label: row.label as string,
        ...(typeof row.display_name === "string"
          ? { displayName: row.display_name }
          : {}),
        accountId: row.account_id as string,
        permissions: JSON.parse(row.permissions_json as string),
        credentialReference:
          typeof row.credential_reference === "string"
            ? row.credential_reference
            : null,
        ignoredAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.ignored_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        includedAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.included_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        ...(row.kind === "manual"
          ? {
              hasManualRecord: row.has_manual_record !== 0,
              ...(typeof row.manual_asset_class === "string"
                ? {
                    manualAssetClass:
                      row.manual_asset_class as ManualAssetClass,
                  }
                : {}),
            }
          : {}),
        snapshot: {
          total: {
            amount: snapshot.total_amount as string,
            currency: snapshot.total_currency as string,
          },
          holdings: JSON.parse(snapshot.holdings_json as string),
          ...(unrecognizedEvmTokens.length === 0
            ? {}
            : { unrecognizedEvmTokens }),
          exchangeRates: JSON.parse(snapshot.exchange_rates_json as string),
          ...(snapshot.coverage_json === null
            ? {}
            : {
                coverage: JSON.parse(snapshot.coverage_json as string),
              }),
          syncedAt: snapshot.synced_at as string,
        },
        sync: normalizeAssetSyncState({
          status: sync.status as "current" | "expired",
          lastSuccessfulAt: sync.last_successful_at as string,
          lastAttemptAt: sync.last_attempt_at as string,
          error: sync.error as string | null,
          ...(sync.failed_mode === null
            ? {}
            : { failedMode: sync.failed_mode as "all" | "prices" | "holdings" }),
          ...(sync.diagnostic_json === null
            ? {}
            : { diagnostic: JSON.parse(sync.diagnostic_json as string) }),
          ...(sync.recent_attempts_json === "[]" ? {} : {
            recentAttempts: JSON.parse((sync.recent_attempts_json as string | null) ?? "[]"),
          }),
        }),
        ...(row.lifecycle === null
          ? {}
          : { lifecycle: row.lifecycle as "connected" | "disconnected" }),
      });
    });
  }

  private listManualAssetRecordsSync(): ManualAssetRecord[] {
    const rows = this.database
      .prepare(`
        SELECT source_id, day, amount, currency, recorded_at
        FROM manual_asset_records
        ORDER BY source_id, day DESC
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      sourceId: row.source_id as string,
      day: row.day as string,
      amount: row.amount as string,
      currency: row.currency as ManualAssetRecord["currency"],
      recordedAt: row.recorded_at as string,
    }));
  }

  private listInvestmentCashflowsSync(): InvestmentCashflow[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM investment_cashflows
        ORDER BY occurred_at DESC, created_at DESC, id DESC
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as InvestmentCashflow["kind"],
      occurredAt: row.occurred_at as string,
      amount: row.amount as string,
      currency: row.currency as InvestmentCashflow["currency"],
      note: row.note as string | null,
      amounts: {
        USD: row.amount_usd as string | null,
        CNY: row.amount_cny as string | null,
        HKD: row.amount_hkd as string | null,
      },
      exchangeRates: JSON.parse(row.exchange_rates_json as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  private listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    return this.listDailyObservationsSync(
      "daily_asset_snapshots",
      "daily_asset_source_snapshots",
    );
  }

  private listDailyAssetTrendObservationsSync(): DailyAssetTrendObservation[] {
    return this.listDailyObservationsSync(
      "daily_asset_trend_observations",
      "daily_asset_source_trend_observations",
    );
  }

  private listImportedSourceHistoryObservationsSync():
    ImportedAssetSourceHistoryObservation[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM imported_asset_source_history_observations
        ORDER BY day, source_id
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      day: row.day as string,
      sourceId: row.source_id as string,
      label: row.label as string,
      kind: row.kind as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as ImportedAssetSourceHistoryObservation["status"],
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
    }));
  }

  private listDailyObservationsSync(
    snapshotTable: "daily_asset_snapshots" | "daily_asset_trend_observations",
    sourceTable:
      | "daily_asset_source_snapshots"
      | "daily_asset_source_trend_observations",
  ): DailyAssetSnapshot[] {
    const rows = this.database
      .prepare(`SELECT * FROM ${snapshotTable} ORDER BY day`)
      .all() as SqliteRow[];
    return rows.map((row) => migrateDailyObservation({
      day: row.day as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as "complete" | "incomplete" | "expired",
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
      exchangeRates: JSON.parse(
        (row.exchange_rates_json as string | null) ?? "[]",
      ),
      sources: this.dailySourceRows(row.day as string, sourceTable).map((source) => ({
        sourceId: source.source_id as string,
        label: source.label as string,
        kind: source.kind as string,
        capturedAt: source.captured_at as string,
        complete: source.complete === 1,
        status: source.status as "complete" | "incomplete" | "expired",
        total: {
          USD: source.total_usd as string | null,
          CNY: source.total_cny as string | null,
          HKD: source.total_hkd as string | null,
        },
        ...(source.asset_class_totals_json === null
          ? {}
          : {
              assetClassTotals: JSON.parse(
                source.asset_class_totals_json as string,
              ),
            }),
      })),
    }));
  }

  async listAssetCards(): Promise<Card[]> {
    const rows = this.database
      .prepare("SELECT * FROM asset_cards ORDER BY position")
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: "asset",
      title: row.title as string,
      body: row.body as string,
      span: row.span as 1 | 2 | 3,
      ...(row.source_id === null ? {} : { sourceId: row.source_id as string }),
      ...(row.hidden === null ? {} : { hidden: row.hidden === 1 }),
      ...(row.starts_new_row === null
        ? {}
        : { startsNewRow: row.starts_new_row === 1 }),
    }));
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    this.transaction(() => {
      this.database.exec("DELETE FROM asset_cards");
      cards.forEach((card, position) => this.insertCard(card, position));
    });
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    return this.listSourcesSync();
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    this.transaction(() => {
      this.database.exec(`
        DELETE FROM formal_daily_settlements;
        DELETE FROM asset_source_snapshots;
        DELETE FROM asset_source_sync_states;
        DELETE FROM asset_sources;
      `);
      sources.forEach((source, position) => this.insertSource(source, position));
    });
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT id FROM asset_sources WHERE id = ?")
        .get(source.id);
      if (existing === undefined) return;
      this.database
        .prepare(`
          UPDATE asset_sources
          SET kind = ?, label = ?, display_name = ?, account_id = ?,
              permissions_json = ?, credential_reference = ?,
              ignored_asset_keys_json = ?, included_asset_keys_json = ?,
              manual_asset_class = ?, lifecycle = ?
          WHERE id = ?
        `)
        .run(
          source.kind,
          source.label,
          source.displayName ?? null,
          source.accountId,
          JSON.stringify(source.permissions),
          source.credentialReference,
          JSON.stringify(source.ignoredAssetKeys ?? []),
          JSON.stringify(source.includedAssetKeys ?? []),
          source.kind === "manual" ? source.manualAssetClass ?? null : null,
          source.lifecycle ?? null,
          source.id,
        );
      this.upsertSourceDetails(source);
    });
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    return this.listDailyAssetSnapshotsSync();
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    return this.listDailyAssetTrendObservationsSync();
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return this.listImportedSourceHistoryObservationsSync();
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    return this.listManualAssetRecordsSync();
  }

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return this.listInvestmentCashflowsSync();
  }

  async createInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.transaction(() => {
      this.insertInvestmentCashflow(cashflow);
    });
  }

  async updateInvestmentCashflow(
    cashflow: InvestmentCashflow,
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare(`
          UPDATE investment_cashflows
          SET kind = ?, occurred_at = ?, amount = ?, currency = ?, note = ?,
              amount_usd = ?, amount_cny = ?, amount_hkd = ?,
              exchange_rates_json = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          cashflow.kind,
          cashflow.occurredAt,
          cashflow.amount,
          cashflow.currency,
          cashflow.note,
          cashflow.amounts.USD,
          cashflow.amounts.CNY,
          cashflow.amounts.HKD,
          JSON.stringify(cashflow.exchangeRates),
          cashflow.updatedAt,
          cashflow.id,
        );
      if (result.changes !== 1) throw new Error("资金记录不存在");
    });
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM investment_cashflows WHERE id = ?")
        .run(id);
      if (result.changes !== 1) throw new Error("资金记录不存在");
    });
  }

  async latestFormalSettlementExecution(): Promise<FormalSettlementExecution | null> {
    const row = this.database.prepare(
      "SELECT payload_json FROM formal_settlement_execution WHERE id = 1",
    ).get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as FormalSettlementExecution : null;
  }

  async recordFormalSettlementExecution(execution: FormalSettlementExecution): Promise<void> {
    this.database.prepare(
      "INSERT INTO formal_settlement_execution (id, started_at, payload_json) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, payload_json = excluded.payload_json " +
      "WHERE excluded.started_at >= formal_settlement_execution.started_at",
    ).run(execution.startedAt, JSON.stringify(execution));
  }

  async listFormalDailySettlements(): Promise<FormalDailySettlement[]> {
    const rows = this.database
      .prepare(`
        SELECT * FROM formal_daily_settlements
        ORDER BY scheduled_close_at DESC, anchor_key DESC
      `)
      .all() as SqliteRow[];
    return rows.map((row) => {
      const anchor = row.anchor_kind === "securities-close"
        ? {
            key: row.anchor_key as string,
            kind: "securities-close" as const,
            market: row.anchor_market as NonNullable<
              FormalDailySettlement["anchor"] extends { market: infer Market }
                ? Market
                : never
            >,
            tradingDay: row.anchor_trading_day as string,
            scheduledCloseAt: row.scheduled_close_at as string,
          }
        : {
            key: row.anchor_key as string,
            kind: "crypto-cutoff" as const,
            market: null,
            tradingDay: row.anchor_trading_day as string,
            scheduledCloseAt: row.scheduled_close_at as string,
          };
      const sources = this.database
        .prepare(`
          SELECT * FROM formal_daily_settlement_sources
          WHERE anchor_key = ?
          ORDER BY rowid
        `)
        .all(row.anchor_key) as SqliteRow[];
      const holdings = this.database
        .prepare(`
          SELECT * FROM formal_daily_settlement_holdings
          WHERE anchor_key = ?
          ORDER BY rowid
        `)
        .all(row.anchor_key) as SqliteRow[];
      return {
        anchor,
        capturedAt: row.captured_at as string | null,
        status: row.status as FormalDailySettlement["status"],
        diagnostic: row.diagnostic as string | null,
        total: {
          USD: row.total_usd as string | null,
          CNY: row.total_cny as string | null,
          HKD: row.total_hkd as string | null,
        },
        exchangeRates: JSON.parse(row.exchange_rates_json as string),
        sources: sources.map((source) => ({
          sourceId: source.source_id as string,
          label: source.label as string,
          kind: source.kind as string,
          capturedAt: source.captured_at as string | null,
          status: source.status as FormalDailySettlement["status"],
          diagnostic: source.diagnostic as string | null,
          total: {
            USD: source.total_usd as string | null,
            CNY: source.total_cny as string | null,
            HKD: source.total_hkd as string | null,
          },
        })),
        holdings: holdings.map((holding) => ({
          sourceId: holding.source_id as string,
          sourceAsset: holding.source_asset as string | null,
          symbol: holding.symbol as string,
          name: holding.name as string,
          quantity: holding.quantity as string,
          assetClass: holding.asset_class as "securities" | "crypto" | "cash",
          price: holding.price_amount === null
            ? null
            : {
                amount: holding.price_amount as string,
                currency: holding.price_currency as string,
              },
          priceBasis: holding.price_basis as
            | "official-close"
            | "capture-time"
            | "unavailable",
          priceObservedAt: holding.price_observed_at as string | null,
          market: holding.market as FormalDailySettlement["anchor"]["market"],
          marketTradingDay: holding.market_trading_day as string | null,
          marketValue: holding.market_value as string | null,
          diagnostic: holding.diagnostic as string | null,
        })),
      };
    });
  }

  private insertFormalDailySettlement(
    settlement: FormalDailySettlement,
  ): boolean {
      const inserted = this.database
        .prepare(`
          INSERT INTO formal_daily_settlements (
            anchor_key, anchor_kind, anchor_market, anchor_trading_day,
            scheduled_close_at, captured_at, status, diagnostic,
            total_usd, total_cny, total_hkd, exchange_rates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(anchor_key) DO NOTHING
        `)
        .run(
          settlement.anchor.key,
          settlement.anchor.kind,
          settlement.anchor.market,
          settlement.anchor.tradingDay,
          settlement.anchor.scheduledCloseAt,
          settlement.capturedAt,
          settlement.status,
          settlement.diagnostic,
          settlement.total.USD,
          settlement.total.CNY,
          settlement.total.HKD,
          JSON.stringify(settlement.exchangeRates),
        ).changes > 0;
      if (!inserted) return false;
      const sourceStatement = this.database.prepare(`
        INSERT INTO formal_daily_settlement_sources (
          anchor_key, source_id, label, kind, captured_at, status, diagnostic,
          total_usd, total_cny, total_hkd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const source of settlement.sources) {
        sourceStatement.run(
          settlement.anchor.key,
          source.sourceId,
          source.label,
          source.kind,
          source.capturedAt,
          source.status,
          source.diagnostic,
          source.total.USD,
          source.total.CNY,
          source.total.HKD,
        );
      }
      const holdingStatement = this.database.prepare(`
        INSERT INTO formal_daily_settlement_holdings (
          anchor_key, source_id, source_identity, source_asset, symbol, name,
          quantity, asset_class, price_amount, price_currency, price_basis,
          price_observed_at, market, market_trading_day, market_value, diagnostic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const holding of settlement.holdings) {
        holdingStatement.run(
          settlement.anchor.key,
          holding.sourceId,
          holding.sourceAsset ?? holding.symbol,
          holding.sourceAsset,
          holding.symbol,
          holding.name,
          holding.quantity,
          holding.assetClass,
          holding.price?.amount ?? null,
          holding.price?.currency ?? null,
          holding.priceBasis,
          holding.priceObservedAt,
          holding.market,
          holding.marketTradingDay,
          holding.marketValue,
          holding.diagnostic,
        );
      }
      return true;
  }

  async recordFormalDailySettlementIfAbsent(
    settlement: FormalDailySettlement,
  ): Promise<boolean> {
    return this.transaction(() => this.insertFormalDailySettlement(settlement));
  }

  async validateBusinessData(state: BusinessDataState): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.replaceState(state);
      this.assertIntegrity();
      this.database.exec("ROLLBACK");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // 优先抛出备份验证错误。
      }
      throw error;
    }
  }

  async replaceBusinessData(state: BusinessDataState): Promise<void> {
    this.transaction(() => {
      this.replaceState(state);
      this.assertIntegrity();
    });
  }

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.transaction(() => {
      const inserted = this.insertDailyBaseline(snapshot);
      if (inserted) this.upsertDailyTrendObservation(snapshot);
      return inserted;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    this.transaction(() => {
      const baseline = this.database
        .prepare("SELECT status FROM daily_asset_snapshots WHERE day = ?")
        .get(snapshot.day) as { status: "complete" | "incomplete" | "expired" }
          | undefined;
      if (baseline === undefined && createBaseline) {
        this.insertDailyBaseline(snapshot);
      } else if (
        createBaseline &&
        baseline !== undefined &&
        baseline.status === "expired"
      ) {
        this.replaceExpiredDailyBaseline(snapshot);
      }
      const hasTrend = this.database
        .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
        .get(snapshot.day) !== undefined;
      const existing = hasTrend
        ? this.listDailyAssetTrendObservationsSync().find(
            ({ day }) => day === snapshot.day,
          )
        : undefined;
      this.upsertDailyTrendObservation(
        existing
          ? mergeDailyTrendObservation(existing, snapshot, !createBaseline)
          : snapshot,
      );
    });
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    this.transaction(() => {
      if (
        this.database
          .prepare("SELECT id FROM asset_sources WHERE id = ?")
          .get(sourceId) === undefined
      ) {
        throw new Error("资产来源不存在");
      }
      const result = this.database
        .prepare("UPDATE asset_cards SET hidden = ? WHERE source_id = ?")
        .run(Number(hidden), sourceId);
      if (result.changes === 0) throw new Error("资产卡片不存在");
    });
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare("UPDATE asset_sources SET display_name = ? WHERE id = ?")
        .run(displayName, sourceId);
      if (result.changes === 0) throw new Error("资产来源不存在");
    });
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    this.transaction(() => {
      const source = this.database
        .prepare("SELECT kind FROM asset_sources WHERE id = ?")
        .get(sourceId) as { kind: string } | undefined;
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产来源可以设置资产类别");
      }
      this.database
        .prepare(
          "UPDATE asset_sources SET manual_asset_class = ? WHERE id = ?",
        )
        .run(assetClass, sourceId);
    });
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE asset_sources
           SET ignored_asset_keys_json = ?, included_asset_keys_json = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(ignoredAssetKeys),
          JSON.stringify(includedAssetKeys),
          sourceId,
        );
      if (result.changes === 0) throw new Error("资产来源不存在");
    });
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      const sourceId = randomUUID();
      const source: AssetSourceSummary = {
        id: sourceId,
        kind: "manual",
        label: input.label,
        hasManualRecord: false,
        accountId: `manual:${sourceId}`,
        permissions: [],
        credentialReference: null,
        snapshot: {
          total: { amount: "0", currency: "CNY" },
          holdings: [],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      };
      const sourcePosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
      ).count as number;
      const cardPosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
      ).count as number;
      this.insertSource(source, sourcePosition);
      this.insertCard(
        {
          id: randomUUID(),
          kind: "asset",
          title: "手工资产记录",
          body: "每日记录资产总额",
          sourceId,
          span: 1,
        },
        cardPosition,
      );
    });
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
      const source = this.listSourcesSync().find(
        (item) => item.id === sourceId,
      );
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以编辑今日总额");
      }
      this.database
        .prepare(`
          INSERT INTO manual_asset_records (
            source_id, day, amount, currency, recorded_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source_id, day) DO UPDATE SET
            amount = excluded.amount,
            currency = excluded.currency,
            recorded_at = excluded.recorded_at
        `)
        .run(sourceId, input.day, input.amount, input.currency, capturedAt);
      const record = this.listManualAssetRecordsSync().find(
        (item) => item.sourceId === sourceId && item.day === input.day,
      );
      if (!record) throw new Error("手工资产记录保存失败");
      const latest = latestManualAssetRecord(
        this.listManualAssetRecordsSync().filter(
          (item) => item.sourceId === sourceId,
        ),
      );
      const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
      this.upsertSourceDetails(updated);
      this.recordManualDailyObservation(updated, record, capturedAt);
    });
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    this.transaction(() => {
      const source = this.listSourcesSync().find(
        (item) => item.id === sourceId,
      );
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以删除");
      }
      const result = this.database
        .prepare(
          "DELETE FROM manual_asset_records WHERE source_id = ? AND day = ?",
        )
        .run(sourceId, day);
      if (result.changes === 0) throw new Error("指定日期没有手工资产记录");
      const latest = latestManualAssetRecord(
        this.listManualAssetRecordsSync().filter(
          (item) => item.sourceId === sourceId,
        ),
      );
      this.upsertSourceDetails(
        applyLatestManualAssetRecord(source, latest, capturedAt),
      );
      for (const [snapshot, sourceTable] of [
        ["daily_asset_snapshots", "daily_asset_source_snapshots"],
        ["daily_asset_trend_observations", "daily_asset_source_trend_observations"],
      ] as const) {
        this.database
          .prepare(`DELETE FROM ${sourceTable} WHERE day = ? AND source_id = ?`)
          .run(day, sourceId);
        this.recalculateDailySnapshot(day, {
          snapshot,
          source: sourceTable,
        });
      }
    });
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => {
      const source = this.database
        .prepare(
          "SELECT kind, credential_reference FROM asset_sources WHERE id = ?",
        )
        .get(sourceId) as SqliteRow | undefined;
      if (source === undefined) throw new Error("资产来源不存在");
      if (source.kind === "manual") {
        throw new Error("手工资产记录不支持断开");
      }
      this.database
        .prepare("UPDATE asset_sources SET lifecycle = 'disconnected' WHERE id = ?")
        .run(sourceId);
      return typeof source.credential_reference === "string"
        ? source.credential_reference
        : null;
    });
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.transaction(() => {
      const source = this.database
        .prepare(
          "SELECT credential_reference FROM asset_sources WHERE id = ?",
        )
        .get(sourceId) as SqliteRow | undefined;
      if (source === undefined) throw new Error("资产来源不存在");
      const baselineDays = this.database
        .prepare(
          "SELECT day FROM daily_asset_source_snapshots WHERE source_id = ?",
        )
        .all(sourceId) as SqliteRow[];
      const trendDays = this.database
        .prepare(
          "SELECT day FROM daily_asset_source_trend_observations WHERE source_id = ?",
        )
        .all(sourceId) as SqliteRow[];
      this.database
        .prepare(`
          DELETE FROM formal_daily_settlements
          WHERE anchor_key IN (
            SELECT anchor_key
            FROM formal_daily_settlement_sources
            WHERE source_id = ?
          )
        `)
        .run(sourceId);
      this.database
        .prepare("DELETE FROM asset_cards WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_snapshots WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_trend_observations WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM imported_asset_source_history_observations WHERE source_id = ?")
        .run(sourceId);
      this.database.prepare("DELETE FROM asset_sources WHERE id = ?").run(sourceId);
      this.compactPositions("asset_sources");
      this.compactPositions("asset_cards");
      for (const { day } of baselineDays) {
        this.recalculateDailySnapshot(day as string, {
          snapshot: "daily_asset_snapshots",
          source: "daily_asset_source_snapshots",
        });
      }
      for (const { day } of trendDays) this.recalculateDailyTrendObservation(day as string);
      return typeof source.credential_reference === "string"
        ? source.credential_reference
        : null;
    });
  }

  async connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("longbridge", result, credentialReference, capturedAt);
  }

  async connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("binance", result, credentialReference, capturedAt);
  }

  async reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<string | null> {
    return this.transaction(() => {
      const source = this.listSourcesSync().find(({ id }) => id === sourceId);
      const kind = connectedSourceKind(sourceKind, result);
      if (!source || source.kind !== kind) {
        throw new Error("资产来源不存在或类型不匹配");
      }
      if (source.accountId !== result.account.id) {
        throw new Error("新授权对应的账户与原来源不一致");
      }
      const updated: AssetSourceSummary = {
        ...source,
        label: result.account.label,
        accountId: result.account.id,
        permissions: result.permissions,
        credentialReference,
        snapshot: result.snapshot,
        lifecycle: "connected",
        sync: {
          status: "current",
          lastSuccessfulAt: result.snapshot.syncedAt,
          lastAttemptAt: result.snapshot.syncedAt,
          error: null,
        },
      };
      this.database
        .prepare(`
          UPDATE asset_sources
          SET label = ?, account_id = ?, permissions_json = ?,
              credential_reference = ?, lifecycle = ?
          WHERE id = ?
        `)
        .run(
          updated.label,
          updated.accountId,
          JSON.stringify(updated.permissions),
          updated.credentialReference,
          "connected",
          updated.id,
      );
      this.upsertSourceDetails(updated);
      return source.credentialReference;
    });
  }

  async connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("okx", result, credentialReference, capturedAt);
  }

  async connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("bitget", result, credentialReference, capturedAt);
  }

  async connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("bit", result, credentialReference, capturedAt);
  }

  async connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    this.connectAssetSource("evm", result, credentialReference, capturedAt);
  }

  private connectAssetSource(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): void {
    this.transaction(() => {
      const isFirstAutomaticSource = this.database
        .prepare("SELECT 1 FROM asset_sources WHERE kind <> 'manual' LIMIT 1")
        .get() === undefined;
      const connected = buildConnectedSource(
        sourceKind,
        result,
        credentialReference,
      );
      const sourcePosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
      ).count as number;
      const cardPosition = (
        this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
      ).count as number;
      this.insertSource(connected.source, sourcePosition);
      this.insertCard(connected.card, cardPosition);
      const observation = buildDailyAssetSnapshot(
        this.listSourcesSync(),
        capturedAt,
      );
      if (isFirstAutomaticSource && observation.complete) {
        const hasBaseline = this.database
          .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
          .get(observation.day) !== undefined;
        if (!hasBaseline) this.insertDailyBaseline(observation);
        this.upsertDailyTrendObservation(observation);
      }
    });
  }
}

/** 独立加密凭证文件；普通 Dashboard 数据与同步快照无法读取其内容。 */
interface StoredSecret {
  sealed: string;
  state: "pending" | "committed";
}

interface TransactionalSecretStore extends SecretStore {
  stage(value: string): Promise<string>;
  commit(reference: string): Promise<void>;
}

export class FileEncryptedSecretStore implements SecretStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private key(): Buffer {
    const encoded = process.env.PAD_SECRET_ENCRYPTION_KEY;
    const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new Error(
        "PAD_SECRET_ENCRYPTION_KEY 必须配置为 32 字节 Base64 服务端密钥",
      );
    }
    return key;
  }

  private seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    });
  }

  private unseal(sealed: string): string {
    const parsed = JSON.parse(sealed) as { iv: string; tag: string; value: string };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private async load(): Promise<Record<string, StoredSecret>> {
    try {
      const value: unknown = JSON.parse(await readPrivateFile(this.filePath));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`凭证存储格式无效: ${this.filePath}`);
      }
      return value as Record<string, StoredSecret>;
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  private async write(values: Record<string, StoredSecret>): Promise<void> {
    await atomicWritePrivateFile(this.filePath, JSON.stringify(values));
  }

  private mutate<T>(operation: (values: Record<string, StoredSecret>) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const values = await this.load();
      const result = operation(values);
      await this.write(values);
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  stage(value: string): Promise<string> {
    return this.mutate((values) => {
      const reference = randomUUID();
      values[reference] = { sealed: this.seal(value), state: "pending" };
      return reference;
    });
  }

  commit(reference: string): Promise<void> {
    return this.mutate((values) => {
      const value = values[reference];
      if (!value) throw new Error("待提交凭证不存在");
      value.state = "committed";
    });
  }

  async put(value: string): Promise<string> {
    const reference = await this.stage(value);
    await this.commit(reference);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    await this.queue;
    const value = (await this.load())[reference];
    return value?.state === "committed" ? this.unseal(value.sealed) : null;
  }

  replace(reference: string, value: string): Promise<void> {
    return this.mutate((values) => {
      const current = values[reference];
      if (!current || current.state !== "committed") {
        throw new Error("凭证引用不存在或尚未提交");
      }
      current.sealed = this.seal(value);
    });
  }

  remove(reference: string): Promise<void> {
    return this.mutate((values) => {
      delete values[reference];
    });
  }

  recover(validReferences: Set<string>): Promise<void> {
    return this.mutate((values) => {
      for (const [reference, value] of Object.entries(values)) {
        if (value.state !== "pending") continue;
        if (validReferences.has(reference)) value.state = "committed";
        else delete values[reference];
      }
    });
  }
}

class DatabaseAssetCardStore implements AssetCardStore {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listAssetCards(); }
  replaceAll(cards: Card[]) { return this.database.replaceAssetCards(cards); }
}

class DatabaseAssetSources implements AssetSources {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listSources(); }
  replaceAll(sources: AssetSourceSummary[]) { return this.database.replaceSources(sources); }
  update(source: AssetSourceSummary) { return this.database.updateSource(source); }
}

class DatabaseManualAssetRecords implements ManualAssetRecords {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly clock: Clock,
  ) {}

  create(input: CreateManualAssetSourceInput): Promise<void> {
    return this.database.createManualAssetSource(
      input,
      this.clock.now().toISOString(),
    );
  }

  list(): Promise<ManualAssetRecord[]> {
    return this.database.listManualAssetRecords();
  }

  record(
    sourceId: string,
    input: ManualAssetRecordInput,
  ): Promise<void> {
    return this.database.recordManualAssetSource(
      sourceId,
      input,
      this.clock.now().toISOString(),
    );
  }

  delete(sourceId: string, day: string): Promise<void> {
    return this.database.deleteManualAssetSourceRecord(
      sourceId,
      day,
      this.clock.now().toISOString(),
    );
  }
}

class DatabaseDailyAssetSnapshots implements DailyAssetSnapshots {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listDailyAssetSnapshots(); }
  listTrendObservations() {
    return this.database.listDailyAssetTrendObservations();
  }
  listImportedSourceHistoryObservations() {
    return this.database.listImportedSourceHistoryObservations();
  }
  createIfAbsent(snapshot: DailyAssetSnapshot) {
    return this.database.createDailyAssetSnapshotIfAbsent(snapshot);
  }
  record(snapshot: DailyAssetTrendObservation, createBaseline: boolean) {
    return this.database.recordDailyAssetObservation(snapshot, createBaseline);
  }
}

export class DatabaseAssetFullRefreshState implements AssetFullRefreshState {
  constructor(private readonly database: SqliteDashboardDatabase) {}

  read() { return this.database.readAssetFullRefreshState(); }
  initialize(attemptedAt: string) {
    return this.database.initializeAssetFullRefresh(attemptedAt);
  }
  claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }) {
    return this.database.claimAssetFullRefresh(input);
  }
  start(attemptedAt: string) {
    return this.database.startAssetFullRefresh(attemptedAt);
  }
  finish(attemptedAt?: string) {
    return this.database.finishAssetFullRefresh(attemptedAt);
  }
  clear() { return this.database.clearAssetFullRefresh(); }
}

export class DatabaseFormalSettlementExecutions implements FormalSettlementExecutions {
  constructor(private readonly database: SqliteDashboardDatabase) {}
  latest() { return this.database.latestFormalSettlementExecution(); }
  record(execution: FormalSettlementExecution) {
    return this.database.recordFormalSettlementExecution(execution);
  }
}

export class DatabaseFormalDailySettlements implements FormalDailySettlements {
  constructor(private readonly database: SqliteDashboardDatabase) {}

  list() {
    return this.database.listFormalDailySettlements();
  }

  recordIfAbsent(settlement: FormalDailySettlement) {
    return this.database.recordFormalDailySettlementIfAbsent(settlement);
  }
}

class DatabaseAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: SecretStore,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    const hasRefreshableSource = (await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    if (!hasRefreshableSource) await this.fullRefreshState.clear();
  }

  setHidden(sourceId: string, hidden: boolean): Promise<void> {
    return this.database.setAssetCardHidden(sourceId, hidden);
  }

  setDisplayName(sourceId: string, displayName: string): Promise<void> {
    return this.database.setAssetSourceDisplayName(
      sourceId,
      normalizeAssetSourceDisplayName(displayName),
    );
  }

  setManualAssetClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    return this.database.setAssetSourceManualClass(sourceId, assetClass);
  }

  async setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    const preferences = updateEvmTokenPreferences(
      source,
      assetKeys,
      status,
    );
    await this.database.setAssetSourceEvmTokenPreferences(
      sourceId,
      preferences.ignoredAssetKeys,
      preferences.includedAssetKeys,
    );
  }

  async disconnect(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
    await this.database.disconnectAssetSource(sourceId);
    await this.clearCycleWhenNoRefreshableSources();
  }

  async restore(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持恢复连接");
    }
    if (source.lifecycle !== "disconnected") {
      throw new Error("资产来源仍处于连接状态，无需恢复");
    }
    if (
      source.credentialReference === null ||
      (await this.secrets.get(source.credentialReference)) === null
    ) {
      throw new Error(
        "原连接凭证已不存在，无法直接恢复。请重新输入原公开地址；原卡片和历史数据仍保留。",
      );
    }
    await this.database.updateSource({ ...source, lifecycle: "connected" });
  }

  async deleteData(sourceId: string): Promise<void> {
    const reference = await this.database.deleteAssetSourceData(sourceId);
    if (reference !== null) await this.secrets.remove(reference);
    await this.clearCycleWhenNoRefreshableSources();
  }
}

export class DatabaseAssetSourceConnections implements AssetSourceConnections {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: TransactionalSecretStore,
    private readonly ready: Promise<void> = Promise.resolve(),
    private readonly clock: Clock = new SystemClock(),
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async connect(
    sourceKind: SourceConnectionKind,
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | BitAuthorizationResult
      | EvmWatchAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ) {
    await this.ready;
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    let isFirstAutomaticSource: boolean;
    try {
      isFirstAutomaticSource = !(await this.database.listSources()).some(
        (source) =>
          source.kind !== "manual" &&
          source.lifecycle !== "disconnected" &&
          source.credentialReference !== null,
      );
      await save(credentialReference, capturedAt);
    } catch (error) {
      if (usesKeychainReference) throw error;
      try {
        await this.secrets.remove(credentialReference);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "资产来源写入失败，待回收凭证将在启动恢复时清理",
        );
      }
      throw error;
    }
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        try {
          const source = (await this.database.listSources()).find(
            (item) => item.credentialReference === credentialReference,
          );
          if (source) await this.database.deleteAssetSourceData(source.id);
          await this.secrets.remove(credentialReference);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "凭证提交失败，资产来源补偿回滚也未能完成",
          );
        }
        throw error;
      }
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private async replaceExisting(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
  ): Promise<void> {
    await this.ready;
    const isFirstAutomaticSource = !(await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        await this.secrets.remove(credentialReference);
        throw error;
      }
    }

    let previousReference: string | null;
    try {
      previousReference = await this.database.reconnectAssetSource(
        sourceId,
        sourceKind,
        result,
        credentialReference,
        capturedAt,
      );
    } catch (error) {
      if (!usesKeychainReference) await this.secrets.remove(credentialReference);
      throw error;
    }
    if (
      previousReference !== null &&
      previousReference !== credentialReference &&
      !isMacOSKeychainCredentialReference(previousReference)
    ) {
      await this.secrets.remove(previousReference);
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private connectOrReplace(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    return this.serialize(() =>
      this.connectOrReplaceSerialized(sourceKind, result, save),
    );
  }

  private async connectOrReplaceSerialized(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    await this.ready;
    const kind = connectedSourceKind(sourceKind, result);
    const existing = (await this.database.listSources()).find(
      (source) =>
        source.kind === kind && source.accountId === result.account.id,
    );
    if (existing) {
      await this.replaceExisting(existing.id, sourceKind, result);
      return;
    }
    await this.connect(sourceKind, result, save);
  }

  connectLongbridge(result: LongbridgeAuthorizationResult) {
    return this.connectOrReplace("longbridge", result, (reference, capturedAt) =>
      this.database.connectLongbridge(result, reference, capturedAt));
  }

  async reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() =>
      this.replaceExisting(sourceId, "longbridge", result),
    );
  }

  connectBinance(result: BinanceAuthorizationResult) {
    return this.connectOrReplace("binance", result, (reference, capturedAt) =>
      this.database.connectBinance(result, reference, capturedAt));
  }

  connectOkx(result: OkxAuthorizationResult) {
    return this.connectOrReplace("okx", result, (reference, capturedAt) =>
      this.database.connectOkx(result, reference, capturedAt));
  }

  connectBitget(result: BitgetAuthorizationResult) {
    return this.connectOrReplace("bitget", result, (reference, capturedAt) =>
      this.database.connectBitget(result, reference, capturedAt));
  }

  connectBit(result: BitAuthorizationResult) {
    return this.connectOrReplace("bit", result, (reference, capturedAt) =>
      this.database.connectBit(result, reference, capturedAt));
  }

  connectEvm(result: EvmWatchAuthorizationResult) {
    return this.connectOrReplace("evm", result, (reference, capturedAt) =>
      this.database.connectEvm(result, reference, capturedAt));
  }

  async reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() => this.replaceExisting(sourceId, "evm", result));
  }

}

class ReadySecretStore implements SecretStore {
  constructor(
    private readonly secrets: FileEncryptedSecretStore,
    private readonly ready: Promise<void>,
  ) {}
  async put(value: string) {
    await this.ready;
    return this.secrets.put(value);
  }
  async get(reference: string) {
    await this.ready;
    return this.secrets.get(reference);
  }
  async replace(reference: string, value: string) {
    await this.ready;
    return this.secrets.replace(reference, value);
  }
  async remove(reference: string) {
    await this.ready;
    return this.secrets.remove(reference);
  }
}

function isOwnerCredential(value: unknown): value is OwnerCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.id === "string" &&
    typeof credential.publicKey === "string" &&
    typeof credential.counter === "number"
  );
}

export class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerCredential(value)) {
      throw new Error(`所有者凭证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerCredential): Promise<void> {
    await atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    );
  }
}

function isOwnerRecoveryCredential(
  value: unknown,
): value is OwnerRecoveryCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    credential.version === 2 &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string" &&
    (credential.lastUsedTotpCounter === null ||
      (typeof credential.lastUsedTotpCounter === "string" &&
        /^\d+$/u.test(credential.lastUsedTotpCounter)))
  );
}

function isLegacyOwnerRecoveryCredential(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.email === "string" &&
    typeof credential.passwordSalt === "string" &&
    typeof credential.passwordHash === "string" &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string"
  );
}

export class FileOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  get(): Promise<OwnerRecoveryCredential | null> {
    return this.serialize(() => this.read());
  }

  private async read(): Promise<OwnerRecoveryCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (isLegacyOwnerRecoveryCredential(value)) {
      await rm(this.filePath, { force: true });
      return null;
    }
    if (!isOwnerRecoveryCredential(value)) {
      throw new Error(`恢复认证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  save(credential: OwnerRecoveryCredential): Promise<void> {
    return this.serialize(() => atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    ));
  }

  claimTotpCounter(counter: string): Promise<boolean> {
    return this.serialize(async () => {
      const credential = await this.read();
      if (!credential) return false;
      const previous = credential.lastUsedTotpCounter;
      if (previous !== null && BigInt(counter) <= BigInt(previous)) return false;
      await atomicWritePrivateFile(
        this.filePath,
        JSON.stringify({ ...credential, lastUsedTotpCounter: counter }, null, 2),
      );
      return true;
    });
  }
}

export function createProductionServices(
  dataDir = process.env.KANBAN_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
): AppServices {
  hardenLocalDataPermissions(dataDir);
  const clock = new SystemClock();
  const database = new SqliteDashboardDatabase(
    path.join(dataDir, "dashboard.sqlite"),
    path.join(dataDir, "dashboard.json"),
    path.join(dataDir, "cards.json"),
  );
  const secrets = new FileEncryptedSecretStore(
    path.join(dataDir, "secrets.json"),
  );
  const secretRecovery = database.listSources().then(async (sources) => {
    await secrets.recover(
      new Set(
        sources.flatMap((source) =>
          source.credentialReference === null
            ? []
            : [source.credentialReference],
        ),
      ),
    );
  });
  void secretRecovery.catch(() => undefined);
  const assetSources = new DatabaseAssetSources(database);
  const manualAssetRecords = new DatabaseManualAssetRecords(database, clock);
  const investmentCashflows = new InvestmentCashflowLedger(
    database,
    assetSources,
    clock,
  );
  const dailyAssetSnapshots = new DatabaseDailyAssetSnapshots(database);
  const fullRefreshState = new DatabaseAssetFullRefreshState(database);
  const readySecrets = new ReadySecretStore(secrets, secretRecovery);
  const externalServices: ExternalServiceConfiguration =
    new FileExternalServiceConfiguration(
      path.join(dataDir, "external-services.json"),
      readySecrets,
    );
  const prices = new CoinGeckoUsdtUsdPrices(externalServices);
  const evmRefresher = new ProductionEvmWatchSourceRefresher(externalServices);
  const longbridge = new KeychainLongbridgeOAuth();
  const binance = new ProductionBinanceReadOnly(prices);
  const okx = new ProductionOkxReadOnly(prices);
  const bitget = new ProductionBitgetReadOnly(prices);
  const bit = new ProductionBitReadOnly(prices);
  const evm = new ProductionEvmWatchWallet(externalServices);
  const assetSourceConnections = new DatabaseAssetSourceConnections(
    database,
    secrets,
    secretRecovery,
    clock,
    fullRefreshState,
  );
  const assetSourceOnboarding = new AssetSourceOnboarding(
    createAssetSourceProviderAdapters({
      longbridge,
      binance,
      okx,
      bitget,
      bit,
      evm,
      connections: assetSourceConnections,
    }),
  );
  const sourceRefresher = new RoutedAssetSourceRefresher({
    longbridge: new KeychainLongbridgeSourceRefresher(),
    binance: new ProductionBinanceSourceRefresher(prices),
    okx: new ProductionOkxSourceRefresher(prices),
    bitget: new ProductionBitgetSourceRefresher(prices),
    bit: new ProductionBitSourceRefresher(prices),
    "evm-watch-ethereum": evmRefresher,
    "evm-watch-bsc": evmRefresher,
  });
  const formalDailySettlements = new DatabaseFormalDailySettlements(database);
  const formalSettlementExecutions = new DatabaseFormalSettlementExecutions(database);
  return {
    clock,
    assetCards: new DatabaseAssetCardStore(database),
    assetSources,
    manualAssetRecords,
    investmentCashflows,
    assetSourceLifecycle: new DatabaseAssetSourceLifecycle(
      database,
      readySecrets,
      fullRefreshState,
    ),
    dailyAssetSnapshots,
    formalDailySettlements,
    formalSettlementExecutions,
    formalSettlementScheduler: new LocalFormalSettlementScheduler(undefined, { workspace: process.cwd(), dataDir }),
    formalDailySettlementRunner: new ObservedFormalSettlementRunner(new MarketCloseFormalDailySettlement(
      assetSources,
      clock,
      formalDailySettlements,
      new ReadOnlyFormalSettlementSourceCapture(readySecrets, sourceRefresher),
      new KeychainLongbridgeFormalSettlementCandleReader(),
    ), formalSettlementExecutions, clock),
    externalServices,
    assetSynchronization: new SourceIsolatedAssetSynchronization(
      assetSources,
      readySecrets,
      clock,
      sourceRefresher,
      60_000,
      dailyAssetSnapshots,
      fullRefreshState,
    ),
    assetFullRefreshState: fullRefreshState,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new FileOwnerCredentialStore(
      path.join(dataDir, "owner-credential.json"),
    ),
    ownerRecoveryCredentials: new FileOwnerRecoveryCredentialStore(
      path.join(dataDir, "owner-recovery.json"),
    ),
    secrets: readySecrets,
    longbridge,
    longbridgeBenchmarkCandlesticks: new KeychainLongbridgeBenchmarkCandlestickReader(),
    longbridgeHoldingCandlesticks: new KeychainLongbridgeHoldingCandlestickReader(),
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
    bit,
    evm,
    assetSourceConnections,
    assetSourceOnboarding,
    businessDataBackups: new CredentialFreeBusinessDataBackup(
      database,
      path.join(dataDir, "backups"),
      clock,
    ),
  };
}
