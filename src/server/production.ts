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
} from "@/domain/daily-asset-snapshots";
import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
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
  AssetSnapshot,
  AssetSourceConnections,
  AssetSources,
  BinanceAuthorizationResult,
  BitgetAuthorizationResult,
  EvmWatchAuthorizationResult,
  OkxAuthorizationResult,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
  DailyAssetSnapshots,
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
import {
  isLongbridgeUsOptionSymbol,
  LongbridgeOAuthState,
  KeychainLongbridgeOAuth,
  KeychainLongbridgeSourceRefresher,
} from "@/server/asset-sources/longbridge";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
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

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

interface DashboardState {
  schemaVersion: 8;
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
}

const DASHBOARD_SCHEMA_VERSION = 8 as const;
const SQLITE_SCHEMA_VERSION = 8;

type SourceConnectionKind = "longbridge" | "binance" | "okx" | "bitget" | "evm";
type SourceAuthorizationResult =
  | LongbridgeAuthorizationResult
  | BinanceAuthorizationResult
  | OkxAuthorizationResult
  | BitgetAuthorizationResult
  | EvmWatchAuthorizationResult;

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
  setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
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
    snapshot: {
      ...snapshot,
      total,
      holdings,
      exchangeRates,
      ...(coverage === undefined ? {} : { coverage }),
    },
    sync: source.sync ?? {
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
  const complete = observation.complete && total.HKD !== null;
  const status = observation.status === "expired"
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
    sources: observation.sources.map((source) => ({
      ...source,
      complete: source.complete && (source.total.HKD ?? null) !== null,
      status: source.status === "expired"
        ? "expired"
        : source.complete && (source.total.HKD ?? null) !== null
          ? "complete"
          : "incomplete",
      total: {
        ...source.total,
        HKD: source.total.HKD ?? null,
      },
    })),
  };
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
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
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
    return {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      assetCards,
      assetSources: value.assetSources.map(migrateAssetSource),
      dailyAssetSnapshots: Array.isArray(value.dailyAssetSnapshots)
        ? value.dailyAssetSnapshots.map(migrateDailyObservation)
        : [],
      dailyAssetTrendObservations: Array.isArray(value.dailyAssetTrendObservations)
        ? value.dailyAssetTrendObservations.map(migrateDailyObservation)
        : Array.isArray(value.dailyAssetSnapshots)
          ? value.dailyAssetSnapshots.map(migrateDailyObservation)
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
      const baseline = state.dailyAssetSnapshots.find(({ day }) => day === snapshot.day);
      if (baseline === undefined && createBaseline) {
        state.dailyAssetSnapshots.push(structuredClone(snapshot));
        state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
      }
      const index = state.dailyAssetTrendObservations.findIndex(
        ({ day }) => day === snapshot.day,
      );
      if (index === -1) {
        if (!createBaseline) return;
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

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      source.lifecycle = "disconnected";
      return source.credentialReference;
    });
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      state.assetSources = state.assetSources.filter((item) => item.id !== sourceId);
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
      const connected = buildConnectedSource(
        sourceKind,
        result,
        credentialReference,
      );
      state.assetSources.push(connected.source);
      state.assetCards.push(connected.card);
      const dailySnapshot = buildDailyAssetSnapshot(state.assetSources, capturedAt);
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
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
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
      dailyAssetSnapshots: [],
      dailyAssetTrendObservations: [],
    };
  }

  const value = JSON.parse(readFileSync(dashboardPath, "utf8")) as
    Partial<DashboardState> & { cards?: unknown };
  const assetCards = parseAssetCards(value.assetCards ?? value.cards);
  if (assetCards === null || !Array.isArray(value.assetSources)) {
    throw new Error(`Dashboard 数据文件格式无效: ${dashboardPath}`);
  }
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    assetCards,
    assetSources: value.assetSources.map(migrateAssetSource),
    dailyAssetSnapshots: Array.isArray(value.dailyAssetSnapshots)
      ? value.dailyAssetSnapshots.map(migrateDailyObservation)
      : [],
    dailyAssetTrendObservations: Array.isArray(value.dailyAssetTrendObservations)
      ? value.dailyAssetTrendObservations.map(migrateDailyObservation)
      : Array.isArray(value.dailyAssetSnapshots)
        ? value.dailyAssetSnapshots.map(migrateDailyObservation)
        : [],
  };
}

/** SQLite 只保存业务数据与不透明凭证引用；秘密正文仍由 SecretStore 持有。 */
export class SqliteDashboardDatabase implements DashboardDatabase {
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
        lifecycle TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('connected', 'disconnected'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS asset_source_snapshots (
        source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
        total_amount TEXT NOT NULL,
        total_currency TEXT NOT NULL,
        holdings_json TEXT NOT NULL CHECK (json_valid(holdings_json)),
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
        failed_mode TEXT CHECK (failed_mode IS NULL OR failed_mode IN ('all', 'prices', 'holdings'))
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
        PRIMARY KEY (day, source_id)
      ) STRICT;
    `);
    let schemaVersion = this.metadata("schema_version");
    if (schemaVersion === null) {
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
    if (schemaVersion !== String(SQLITE_SCHEMA_VERSION)) {
      throw new Error(`不支持的 SQLite schema 版本: ${schemaVersion}`);
    }
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
      DELETE FROM daily_asset_source_trend_observations;
      DELETE FROM daily_asset_trend_observations;
      DELETE FROM daily_asset_source_snapshots;
      DELETE FROM daily_asset_snapshots;
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
  }

  private insertSource(source: AssetSourceSummary, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, ignored_asset_keys_json, included_asset_keys_json,
          lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        source.lifecycle ?? null,
      );
    this.upsertSourceDetails(source);
  }

  private upsertSourceDetails(source: AssetSourceSummary): void {
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_snapshots (
          source_id, total_amount, total_currency, holdings_json,
          exchange_rates_json, coverage_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.snapshot.total.amount,
        source.snapshot.total.currency,
        JSON.stringify(source.snapshot.holdings),
        JSON.stringify(source.snapshot.exchangeRates),
        source.snapshot.coverage === undefined
          ? null
          : JSON.stringify(source.snapshot.coverage),
        source.snapshot.syncedAt,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_sync_states (
          source_id, status, last_successful_at, last_attempt_at, error, failed_mode
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.sync.status,
        source.sync.lastSuccessfulAt,
        source.sync.lastAttemptAt,
        source.sync.error,
        source.sync.failedMode ?? null,
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
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO daily_asset_source_snapshots (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );
    }
    return inserted;
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
        total_hkd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, source_id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        captured_at = excluded.captured_at,
        complete = excluded.complete,
        status = excluded.status,
        total_usd = excluded.total_usd,
        total_cny = excluded.total_cny,
        total_hkd = excluded.total_hkd
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
      );
    }
    this.recalculateDailyTrendObservation(snapshot.day);
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
          total_hkd
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
        snapshot: {
          total: {
            amount: snapshot.total_amount as string,
            currency: snapshot.total_currency as string,
          },
          holdings: JSON.parse(snapshot.holdings_json as string),
          exchangeRates: JSON.parse(snapshot.exchange_rates_json as string),
          ...(snapshot.coverage_json === null
            ? {}
            : {
                coverage: JSON.parse(snapshot.coverage_json as string),
              }),
          syncedAt: snapshot.synced_at as string,
        },
        sync: {
          status: sync.status as "current" | "expired",
          lastSuccessfulAt: sync.last_successful_at as string,
          lastAttemptAt: sync.last_attempt_at as string,
          error: sync.error as string | null,
          ...(sync.failed_mode === null
            ? {}
            : { failedMode: sync.failed_mode as "all" | "prices" | "holdings" }),
        },
        ...(row.lifecycle === null
          ? {}
          : { lifecycle: row.lifecycle as "connected" | "disconnected" }),
      });
    });
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
              lifecycle = ?
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
      const hasBaseline = this.database
        .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
        .get(snapshot.day) !== undefined;
      if (!hasBaseline && createBaseline) this.insertDailyBaseline(snapshot);
      const hasTrend = this.database
        .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
        .get(snapshot.day) !== undefined;
      if (hasTrend || createBaseline) {
        const existing = hasTrend
          ? this.listDailyAssetTrendObservationsSync().find(
              ({ day }) => day === snapshot.day,
            )
          : undefined;
        this.upsertDailyTrendObservation(
          existing && !createBaseline
            ? mergeDailyTrendObservation(existing, snapshot, true)
            : snapshot,
        );
      }
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

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.transaction(() => {
      const source = this.database
        .prepare(
          "SELECT credential_reference FROM asset_sources WHERE id = ?",
        )
        .get(sourceId) as SqliteRow | undefined;
      if (source === undefined) throw new Error("资产来源不存在");
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
        .prepare("DELETE FROM asset_cards WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_snapshots WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_trend_observations WHERE source_id = ?")
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
      const hasBaseline = this.database
        .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
        .get(observation.day) !== undefined;
      if (!hasBaseline) this.insertDailyBaseline(observation);
      this.upsertDailyTrendObservation(observation);
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

class DatabaseDailyAssetSnapshots implements DailyAssetSnapshots {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listDailyAssetSnapshots(); }
  listTrendObservations() {
    return this.database.listDailyAssetTrendObservations();
  }
  createIfAbsent(snapshot: DailyAssetSnapshot) {
    return this.database.createDailyAssetSnapshotIfAbsent(snapshot);
  }
  record(snapshot: DailyAssetTrendObservation, createBaseline: boolean) {
    return this.database.recordDailyAssetObservation(snapshot, createBaseline);
  }
}

class DatabaseAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: SecretStore,
  ) {}

  setHidden(sourceId: string, hidden: boolean): Promise<void> {
    return this.database.setAssetCardHidden(sourceId, hidden);
  }

  setDisplayName(sourceId: string, displayName: string): Promise<void> {
    return this.database.setAssetSourceDisplayName(
      sourceId,
      normalizeAssetSourceDisplayName(displayName),
    );
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
    const reference = await this.database.disconnectAssetSource(sourceId);
    if (reference !== null) await this.secrets.remove(reference);
  }

  async deleteData(sourceId: string): Promise<void> {
    const reference = await this.database.deleteAssetSourceData(sourceId);
    if (reference !== null) await this.secrets.remove(reference);
  }
}

export class DatabaseAssetSourceConnections implements AssetSourceConnections {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: TransactionalSecretStore,
    private readonly ready: Promise<void> = Promise.resolve(),
    private readonly clock: Clock = new SystemClock(),
  ) {}
  private async connect(
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | EvmWatchAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ) {
    await this.ready;
    const credentialReference = await this.secrets.stage(result.credentials);
    try {
      await save(credentialReference, this.clock.now().toISOString());
    } catch (error) {
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

  connectLongbridge(result: LongbridgeAuthorizationResult) {
    return this.connect(result, (reference, capturedAt) =>
      this.database.connectLongbridge(result, reference, capturedAt));
  }

  connectBinance(result: BinanceAuthorizationResult) {
    return this.connect(result, (reference, capturedAt) =>
      this.database.connectBinance(result, reference, capturedAt));
  }

  connectOkx(result: OkxAuthorizationResult) {
    return this.connect(result, (reference, capturedAt) =>
      this.database.connectOkx(result, reference, capturedAt));
  }

  connectBitget(result: BitgetAuthorizationResult) {
    return this.connect(result, (reference, capturedAt) =>
      this.database.connectBitget(result, reference, capturedAt));
  }

  connectEvm(result: EvmWatchAuthorizationResult) {
    return this.connect(result, (reference, capturedAt) =>
      this.database.connectEvm(result, reference, capturedAt));
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
  dataDir = path.join(process.cwd(), "data"),
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
    await Promise.all(
      sources
        .filter(
          (source) =>
            source.lifecycle === "disconnected" &&
            source.credentialReference !== null,
        )
        .map((source) => secrets.remove(source.credentialReference!)),
    );
  });
  void secretRecovery.catch(() => undefined);
  const assetSources = new DatabaseAssetSources(database);
  const dailyAssetSnapshots = new DatabaseDailyAssetSnapshots(database);
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
  const evm = new ProductionEvmWatchWallet(externalServices);
  const assetSourceConnections = new DatabaseAssetSourceConnections(
    database,
    secrets,
    secretRecovery,
    clock,
  );
  const assetSourceOnboarding = new AssetSourceOnboarding(
    createAssetSourceProviderAdapters({
      longbridge,
      binance,
      okx,
      bitget,
      evm,
      connections: assetSourceConnections,
    }),
  );
  return {
    clock,
    assetCards: new DatabaseAssetCardStore(database),
    assetSources,
    assetSourceLifecycle: new DatabaseAssetSourceLifecycle(
      database,
      readySecrets,
    ),
    dailyAssetSnapshots,
    externalServices,
    assetSynchronization: new SourceIsolatedAssetSynchronization(
      assetSources,
      readySecrets,
      clock,
      new RoutedAssetSourceRefresher({
        longbridge: new KeychainLongbridgeSourceRefresher(),
        binance: new ProductionBinanceSourceRefresher(prices),
        okx: new ProductionOkxSourceRefresher(prices),
        bitget: new ProductionBitgetSourceRefresher(prices),
        "evm-watch-ethereum": evmRefresher,
        "evm-watch-bsc": evmRefresher,
      }),
      60_000,
      dailyAssetSnapshots,
    ),
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
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
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
