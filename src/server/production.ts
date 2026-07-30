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
import { DatabaseSync } from "node:sqlite";

import { decimalAdd, decimalCompare, decimalDivide } from "@/domain/decimal";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
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
  DailyAssetSnapshots,
  AssetCardStore,
  Clock,
  OwnerAuth,
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  SecretStore,
  LongbridgeAuthorizationResult,
} from "@/server/ports";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { parseAssetCards } from "@/server/asset-cards";
import {
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
  schemaVersion: 5;
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
}

const DASHBOARD_SCHEMA_VERSION = 5 as const;
const SQLITE_SCHEMA_VERSION = 4;

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
  createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean>;
  setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void>;
  setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
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
  };
  return {
    ...snapshot,
    sources,
    total,
    complete:
      sources.every((source) => source.complete) && total.USD !== null,
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
    const valuation = hasValuation
      ? legacy.valuation
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
  return {
    ...source,
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
        ? value.dailyAssetSnapshots
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

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.mutate((state) => {
      const existing = state.dailyAssetSnapshots.find(
        ({ day }) => day === snapshot.day,
      );
      if (existing) {
        const existingSourceIds = new Set(
          existing.sources.map(({ sourceId }) => sourceId),
        );
        existing.sources.push(
          ...snapshot.sources.filter(
            ({ sourceId }) => !existingSourceIds.has(sourceId),
          ),
        );
        return false;
      }
      state.dailyAssetSnapshots.push(snapshot);
      state.dailyAssetSnapshots.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
      return true;
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
      const dailySnapshot = buildDailyAssetSnapshot(
        state.assetSources,
        capturedAt,
      );
      const existingDailySnapshot = state.dailyAssetSnapshots.find(
        ({ day }) => day === dailySnapshot.day,
      );
      if (existingDailySnapshot) {
        const existingSourceIds = new Set(
          existingDailySnapshot.sources.map(({ sourceId }) => sourceId),
        );
        existingDailySnapshot.sources.push(
          ...dailySnapshot.sources.filter(
            ({ sourceId }) => !existingSourceIds.has(sourceId),
          ),
        );
      } else {
        state.dailyAssetSnapshots.push(dailySnapshot);
        state.dailyAssetSnapshots.sort((left, right) =>
          left.day.localeCompare(right.day),
        );
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
        dailyAssetSnapshots: [],
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
      ? value.dailyAssetSnapshots
      : [],
  };
}

/** SQLite 只保存业务数据与不透明凭证引用；秘密正文仍由 SecretStore 持有。 */
export class SqliteDashboardDatabase implements DashboardDatabase {
  private database!: DatabaseSync;

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
        total_usd TEXT,
        total_cny TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS daily_asset_source_snapshots (
        day TEXT NOT NULL REFERENCES daily_asset_snapshots(day) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        total_usd TEXT,
        total_cny TEXT,
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
      this.insertDailySnapshot(snapshot),
    );
  }

  private insertSource(source: AssetSourceSummary, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  private insertDailySnapshot(snapshot: DailyAssetSnapshot): boolean {
    const inserted = this.database
      .prepare(`
        INSERT OR IGNORE INTO daily_asset_snapshots (
          day, captured_at, complete, total_usd, total_cny
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.total.USD,
        snapshot.total.CNY,
      ).changes > 0;
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO daily_asset_source_snapshots (
        day, source_id, label, kind, captured_at, complete, total_usd, total_cny
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.total.USD,
        source.total.CNY,
      );
    }
    this.recalculateDailySnapshot(snapshot.day);
    return inserted;
  }

  private recalculateDailySnapshot(day: string): void {
    const sources = this.dailySourceRows(day);
    if (sources.length === 0) {
      this.database.prepare("DELETE FROM daily_asset_snapshots WHERE day = ?").run(day);
      return;
    }
    const totals = (column: "total_usd" | "total_cny") => {
      const values = sources.flatMap((source) =>
        typeof source[column] === "string" ? [source[column]] : [],
      );
      return values.length > 0 ? decimalAdd(...values) : null;
    };
    const totalUsd = totals("total_usd");
    this.database
      .prepare(`
        UPDATE daily_asset_snapshots
        SET complete = ?, total_usd = ?, total_cny = ?
        WHERE day = ?
      `)
      .run(
        Number(
          totalUsd !== null &&
            sources.every((source) => source.complete === 1),
        ),
        totalUsd,
        totals("total_cny"),
        day,
      );
  }

  private dailySourceRows(day: string): SqliteRow[] {
    return this.database
      .prepare(`
        SELECT source_id, label, kind, captured_at, complete, total_usd, total_cny
        FROM daily_asset_source_snapshots
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
      return {
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
      };
    });
  }

  private listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    const rows = this.database
      .prepare("SELECT * FROM daily_asset_snapshots ORDER BY day")
      .all() as SqliteRow[];
    return rows.map((row) => ({
      day: row.day as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
      },
      sources: this.dailySourceRows(row.day as string).map((source) => ({
        sourceId: source.source_id as string,
        label: source.label as string,
        kind: source.kind as string,
        capturedAt: source.captured_at as string,
        complete: source.complete === 1,
        total: {
          USD: source.total_usd as string | null,
          CNY: source.total_cny as string | null,
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
              permissions_json = ?, credential_reference = ?, lifecycle = ?
          WHERE id = ?
        `)
        .run(
          source.kind,
          source.label,
          source.displayName ?? null,
          source.accountId,
          JSON.stringify(source.permissions),
          source.credentialReference,
          source.lifecycle ?? null,
          source.id,
        );
      this.upsertSourceDetails(source);
    });
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    return this.listDailyAssetSnapshotsSync();
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
    return this.transaction(() => this.insertDailySnapshot(snapshot));
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
      const days = this.database
        .prepare(
          "SELECT day FROM daily_asset_source_snapshots WHERE source_id = ?",
        )
        .all(sourceId) as SqliteRow[];
      this.database
        .prepare("DELETE FROM asset_cards WHERE source_id = ?")
        .run(sourceId);
      this.database
        .prepare("DELETE FROM daily_asset_source_snapshots WHERE source_id = ?")
        .run(sourceId);
      this.database.prepare("DELETE FROM asset_sources WHERE id = ?").run(sourceId);
      this.compactPositions("asset_sources");
      this.compactPositions("asset_cards");
      for (const { day } of days) this.recalculateDailySnapshot(day as string);
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
      this.insertDailySnapshot(
        buildDailyAssetSnapshot(this.listSourcesSync(), capturedAt),
      );
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
  createIfAbsent(snapshot: DailyAssetSnapshot) {
    return this.database.createDailyAssetSnapshotIfAbsent(snapshot);
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
  const prices = new CoinGeckoUsdtUsdPrices();
  const readySecrets = new ReadySecretStore(secrets, secretRecovery);
  const evmRefresher = new ProductionEvmWatchSourceRefresher();
  const longbridge = new KeychainLongbridgeOAuth();
  const binance = new ProductionBinanceReadOnly(prices);
  const okx = new ProductionOkxReadOnly(prices);
  const bitget = new ProductionBitgetReadOnly(prices);
  const evm = new ProductionEvmWatchWallet();
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
