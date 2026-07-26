import type {
  AssetSourceSummary,
  AssetSources,
  AssetPermission,
  AssetSourceConnections,
  AssetRefreshMode,
  AssetRefreshReport,
  AssetSourceRefresher,
  AssetSynchronization,
  BinanceAuthorizationResult,
  BinanceReadOnly,
  BitgetAuthorizationResult,
  BitgetAccountMode,
  BitgetReadOnly,
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
  DailyAssetSnapshot,
  DailyAssetSnapshots,
  LongbridgeAuthorizationResult,
  Card,
  CardStore,
  Clock,
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  Prices,
  PriceQuote,
  SecretStore,
  LongbridgeOAuth,
} from "@/server/ports";
import type { AppServices } from "@/server/composition";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import {
  LongbridgeConnectionState,
  collectLongbridgePages,
  mapLongbridgeSnapshot,
} from "@/server/asset-sources/longbridge";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import {
  BinanceConnectionState,
  mapBinanceSnapshot,
  validateBinanceReadOnlyPermissions,
} from "@/server/asset-sources/binance";
import {
  binanceFixture,
  binancePermissions,
} from "@/server/testing/binance-fixtures";
import {
  OkxConnectionState,
  validateOkxReadOnlyPermission,
} from "@/server/asset-sources/okx";
import { okxFixtureSnapshot } from "@/server/testing/okx-fixtures";
import {
  BitgetConnectionState,
  validateBitgetReadOnlyPermission,
} from "@/server/asset-sources/bitget";
import { bitgetFixtureSnapshot } from "@/server/testing/bitget-fixtures";

export class FakeClock implements Clock {
  private current = new Date("2026-01-01T00:00:00.000Z");

  now(): Date {
    return this.current;
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export class InMemoryCardStore implements CardStore {
  private cards: Card[] = [];

  async list(): Promise<Card[]> {
    return this.cards;
  }

  async replaceAll(cards: Card[]): Promise<void> {
    this.cards = cards;
  }
}

export class FakeAssetSources implements AssetSources {
  private sources: AssetSourceSummary[] = [];

  async list(): Promise<AssetSourceSummary[]> {
    return this.sources;
  }

  async replaceAll(sources: AssetSourceSummary[]): Promise<void> {
    this.sources = sources;
  }

  async update(source: AssetSourceSummary): Promise<void> {
    const index = this.sources.findIndex((item) => item.id === source.id);
    if (index === -1) return;
    this.sources = this.sources.map((item) =>
      item.id === source.id ? source : item,
    );
  }
}

export class InMemoryDailyAssetSnapshots implements DailyAssetSnapshots {
  private snapshots: DailyAssetSnapshot[] = [];

  async list(): Promise<DailyAssetSnapshot[]> {
    return this.snapshots;
  }

  async createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean> {
    const existing = this.snapshots.find(({ day }) => day === snapshot.day);
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
    this.snapshots = [...this.snapshots, snapshot].sort((left, right) =>
      left.day.localeCompare(right.day),
    );
    return true;
  }
}

export interface FakeLongbridgeConfig {
  credentials: { accessToken: string; refreshToken: string };
  permissions: AssetPermission[];
  account: { id: string; label: string };
  accountPages: unknown[];
  positionPages: unknown[];
  quotePages?: unknown[];
  exchangeRatePages?: unknown[];
  profitPages?: unknown[];
  previewError?: string;
  commitError?: string;
}

export class FakeLongbridgeOAuth implements LongbridgeOAuth {
  private config: FakeLongbridgeConfig | null = null;
  fetchedPositionPages = 0;
  fetchedProfitPages = 0;

  configure(config: FakeLongbridgeConfig): void {
    this.config = config;
    this.fetchedPositionPages = 0;
    this.fetchedProfitPages = 0;
  }

  async start(redirectUri: string) {
    if (!this.config) throw new Error("长桥测试替身尚未配置");
    const state = "fake-longbridge-state";
    const url = new URL("/test-doubles/longbridge/authorize", redirectUri);
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      state,
      codeVerifier: "fake-code-verifier",
    };
  }

  async finish() {
    const config = this.config;
    if (!config) throw new Error("长桥测试替身尚未配置");
    if (config.previewError) throw new Error(config.previewError);
    const positionPages = config.positionPages;
    this.fetchedPositionPages = positionPages.length;
    const profitPages = await collectLongbridgePages(async (page) => {
      const value = config.profitPages?.[page - 1];
      if (value === undefined) throw new Error("长桥平台盈亏分页测试样本不足");
      this.fetchedProfitPages += 1;
      return value;
    });
    const quotePrices = Object.fromEntries(
      (config.quotePages ?? []).flatMap((page) => {
        if (typeof page !== "object" || page === null) return [];
        const root = page as { data?: { list?: Array<{ symbol?: unknown; last_done?: unknown }> } };
        return (root.data?.list ?? []).flatMap((quote) =>
          typeof quote.symbol === "string" && typeof quote.last_done === "string"
            ? [[quote.symbol, quote.last_done] as const]
            : [],
        );
      }),
    );
    const quotePrevious = Object.fromEntries(
      (config.quotePages ?? []).flatMap((page) => {
        if (typeof page !== "object" || page === null) return [];
        const root = page as { data?: { list?: Array<{ symbol?: unknown; prev_close?: unknown }> } };
        return (root.data?.list ?? []).flatMap((quote) =>
          typeof quote.symbol === "string" && typeof quote.prev_close === "string"
            ? [[quote.symbol, quote.prev_close] as const]
            : [],
        );
      }),
    );
    const quoteTimes = Object.fromEntries(
      (config.quotePages ?? []).flatMap((page) => {
        if (typeof page !== "object" || page === null) return [];
        const root = page as { data?: { list?: Array<{ symbol?: unknown; timestamp?: unknown }> } };
        return (root.data?.list ?? []).flatMap((quote) =>
          typeof quote.symbol === "string" && typeof quote.timestamp === "string"
            ? [[quote.symbol, quote.timestamp] as const]
            : [],
        );
      }),
    );
    return {
      credentials: JSON.stringify(config.credentials),
      permissions: config.permissions,
      account: config.account,
      snapshot: mapLongbridgeSnapshot({
        accountPages: config.accountPages,
        positionPages,
        syncedAt: "2026-01-01T00:00:00.000Z",
        quotePrices,
        quotePrevious,
        quoteTimes,
        exchangeRatePages: config.exchangeRatePages,
        profitPages,
      }),
    };
  }
}

export class FakePrices implements Prices {
  private readonly quotes = new Map<string, PriceQuote>();

  setQuote(quote: PriceQuote | null): void {
    this.quotes.clear();
    if (quote) this.quotes.set(quote.symbol, quote);
  }

  async quote(symbol: string): Promise<PriceQuote | null> {
    return this.quotes.get(symbol) ?? null;
  }
}

export class FakeBinanceReadOnly implements BinanceReadOnly {
  private scenario = "valid";

  constructor(private readonly prices: Prices) {}

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    const permissions = validateBinanceReadOnlyPermissions(
      binancePermissions(this.scenario),
    );
    const fixture = binanceFixture(this.scenario === "missing-price");
    return {
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
      }),
      permissions,
      account: {
        id: "binance:900001",
        label: "Binance 账户 · UID 900001",
      },
      snapshot: mapBinanceSnapshot({
        ...fixture,
        observedAt: input.observedAt,
        usdtUsdQuote: await this.prices.quote("USDT"),
      }),
    };
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    let credentials: { apiKey?: unknown; apiSecret?: unknown };
    try {
      credentials = JSON.parse(input.credentials) as typeof credentials;
    } catch {
      return Promise.reject(new Error("Binance 只读凭证格式无效"));
    }
    if (
      typeof credentials.apiKey !== "string" ||
      typeof credentials.apiSecret !== "string"
    ) {
      return Promise.reject(new Error("Binance 只读凭证格式无效"));
    }
    return this.preview({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      observedAt: input.observedAt,
    });
  }
}

export class FakeOkxReadOnly implements OkxReadOnly {
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private permission(): string {
    const permissions: Record<string, string> = {
      valid: "read_only",
      trade: "trade",
      withdraw: "withdraw",
      "read-and-trade": "read_only,trade",
      "unknown-permission": "read_only,new_permission",
      "missing-read": "",
      "commit-failure": "read_only",
    };
    return permissions[this.scenario] ?? "read_only";
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    const permissions = validateOkxReadOnlyPermission(this.permission());
    const uid = this.scenario === "identity-changed" ? "880002" : "880001";
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
        region: input.region ?? "global",
      }),
      permissions,
      account: { id: `okx:${uid}`, label: `OKX 账户 · UID ${uid}` },
      scopeFingerprint: `${uid}:${uid}:0`,
      snapshot: okxFixtureSnapshot(input.observedAt),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      region?: OkxRegion;
    };
    return this.preview({ ...credentials, observedAt: input.observedAt });
  }
}

export class FakeBitgetReadOnly implements BitgetReadOnly {
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private authorities(): unknown {
    const values: Record<string, unknown> = {
      valid: ["stor", "wtor"],
      trade: ["stor", "stow"],
      transfer: ["stor", "wtow"],
      withdraw: ["stor", "wow"],
      "read-and-write": ["stor", "stow", "wtow"],
      "unknown-permission": ["stor", "future_new_scope"],
      "missing-read": [],
      "commit-failure": ["stor", "wtor"],
    };
    return values[this.scenario] ?? ["stor", "wtor"];
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    const permissions = validateBitgetReadOnlyPermission(this.authorities());
    const userId = this.scenario === "identity-changed" ? "770002" : "770001";
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
        accountMode: input.accountMode,
      }),
      accountMode: input.accountMode,
      permissions,
      account: {
        id: `bitget:${userId}`,
        label: `Bitget 账户 · UID ${userId}`,
      },
      scopeFingerprint: `${userId}:770001:${input.accountMode}:stor,wtor`,
      snapshot: bitgetFixtureSnapshot(input.observedAt),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      accountMode: BitgetAccountMode;
    };
    return this.preview({ ...credentials, observedAt: input.observedAt });
  }
}

export type FakeRefreshScenario =
  | "passthrough"
  | "schedule"
  | "partial-failure"
  | "timeout-isolation"
  | "all-failure"
  | "longbridge-refresh-failure"
  | "binance-refresh-failure"
  | "okx-refresh-failure"
  | "bitget-refresh-failure";

export class FakeAssetSourceRefresher implements AssetSourceRefresher {
  private scenario: FakeRefreshScenario = "passthrough";
  private recovered = false;
  private readonly sourceCalls = new Map<string, number>();

  configure(scenario: FakeRefreshScenario): void {
    this.scenario = scenario;
    this.recovered = false;
    this.sourceCalls.clear();
  }

  recover(): void {
    this.recovered = true;
  }

  async refresh({
    source,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    if (this.scenario === "passthrough") {
      return { snapshot: source.snapshot };
    }
    const count = (this.sourceCalls.get(source.id) ?? 0) + 1;
    this.sourceCalls.set(source.id, count);
    if (this.scenario === "all-failure") {
      throw new Error("全部来源暂时不可用");
    }
    if (
      this.scenario === "longbridge-refresh-failure" &&
      source.kind === "longbridge"
    ) {
      throw new Error("长桥同步失败");
    }
    if (
      this.scenario === "binance-refresh-failure" &&
      source.kind === "binance"
    ) {
      throw new Error("Binance 同步失败");
    }
    if (
      this.scenario === "okx-refresh-failure" &&
      source.kind === "okx"
    ) {
      throw new Error("OKX 同步失败");
    }
    if (
      this.scenario === "bitget-refresh-failure" &&
      source.kind === "bitget"
    ) {
      throw new Error("Bitget 同步失败");
    }
    if (source.id === "source-unvalued") {
      return {
        snapshot: { ...source.snapshot, syncedAt: attemptedAt },
      };
    }
    if (
      this.scenario === "timeout-isolation" &&
      source.id === "source-beta"
    ) {
      await new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("来源请求已取消")),
          { once: true },
        );
      });
    }
    if (
      this.scenario === "partial-failure" &&
      source.id === "source-beta" &&
      !this.recovered
    ) {
      throw new Error("来源暂时不可用");
    }
    const amount = this.scenario === "schedule"
      ? String((source.id === "source-alpha" ? 100 : 200) + count)
      : this.scenario === "timeout-isolation"
        ? "110"
      : source.id === "source-alpha"
        ? this.recovered ? "120" : "110"
        : "210";
    const holdings = source.snapshot.holdings.map((holding, index) =>
      index === 0
        ? {
            ...holding,
            currentPrice: { amount, currency: "USD" },
            marketValue: amount,
            sourceMarketValue: { amount, currency: "USD" },
            valuation: {
              status: "valued" as const,
              priceSource: `${source.label} 确定性行情`,
              pricedAt: attemptedAt,
            },
          }
        : holding,
    );
    return {
      snapshot: {
        ...source.snapshot,
        total: { amount, currency: "USD" },
        holdings,
        syncedAt: attemptedAt,
      },
    };
  }
}

export class FakeAssetSynchronization implements AssetSynchronization {
  readonly modes: AssetRefreshMode[] = [];
  active = 0;
  private holdNext = false;
  private releasePending: (() => void) | null = null;

  constructor(
    private readonly delegate: SourceIsolatedAssetSynchronization,
    readonly refresher: FakeAssetSourceRefresher,
  ) {}

  reset(scenario: FakeRefreshScenario): void {
    this.modes.length = 0;
    this.active = 0;
    this.holdNext = false;
    this.releasePending = null;
    this.refresher.configure(scenario);
  }

  prepareRecovery(hold: boolean): void {
    this.refresher.recover();
    this.holdNext = hold;
  }

  release(): void {
    this.releasePending?.();
    this.releasePending = null;
  }

  async refresh(mode: AssetRefreshMode): Promise<AssetRefreshReport> {
    this.modes.push(mode);
    this.active += 1;
    try {
      if (this.holdNext) {
        this.holdNext = false;
        await new Promise<void>((resolve) => {
          this.releasePending = resolve;
        });
      }
      return await this.delegate.refresh(mode);
    } finally {
      this.active -= 1;
    }
  }
}

export class InMemoryOwnerCredentialStore implements OwnerCredentialStore {
  private credential: OwnerCredential | null = null;

  async get(): Promise<OwnerCredential | null> {
    return this.credential;
  }

  async save(credential: OwnerCredential): Promise<void> {
    this.credential = credential;
  }
}

export class InMemoryOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  private credential: OwnerRecoveryCredential | null = null;

  async get(): Promise<OwnerRecoveryCredential | null> {
    return this.credential;
  }

  async save(credential: OwnerRecoveryCredential): Promise<void> {
    this.credential = credential;
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  private sequence = 0;

  async put(value: string): Promise<string> {
    this.sequence += 1;
    const reference = `test-secret-${this.sequence}`;
    this.values.set(reference, value);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    return this.values.get(reference) ?? null;
  }

  async replace(reference: string, value: string): Promise<void> {
    if (!this.values.has(reference)) throw new Error("凭证引用不存在");
    this.values.set(reference, value);
  }

  async remove(reference: string): Promise<void> {
    this.values.delete(reference);
  }

  size(): number {
    return this.values.size;
  }
}

export class InMemoryAssetSourceConnections implements AssetSourceConnections {
  private failMessage: string | null = null;

  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryCardStore,
    private readonly secrets: InMemorySecretStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly clock: Clock,
  ) {}

  failNext(message: string | undefined): void {
    this.failMessage = message ?? null;
  }

  private async connect(
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult,
    config: { kind: string; title: string; body: string },
  ): Promise<void> {
    const credentialReference = await this.secrets.put(result.credentials);
    if (this.failMessage) {
      const message = this.failMessage;
      this.failMessage = null;
      await this.secrets.remove(credentialReference);
      throw new Error(message);
    }
    const sourceId = `test-${config.kind}-source-${(await this.sources.list()).length + 1}`;
    const updatedSources: AssetSourceSummary[] = [
      ...(await this.sources.list()),
      {
        id: sourceId,
        kind: config.kind,
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
    ];
    await this.sources.replaceAll(updatedSources);
    await this.cards.replaceAll([
      ...(await this.cards.list()),
      {
        id: `test-${config.kind}-card-${sourceId}`,
        kind: "asset",
        access: "private",
        title: config.title,
        body: config.body,
        sourceId,
        span: 2,
      },
    ]);
    await this.dailySnapshots.createIfAbsent(
      buildDailyAssetSnapshot(updatedSources, this.clock.now().toISOString()),
    );
  }

  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "longbridge",
      title: "长桥资产",
      body: "只读证券账户",
    });
  }

  connectBinance(result: BinanceAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "binance",
      title: "Binance 资产",
      body: "现货、资金与 Simple Earn 只读账户",
    });
  }

  connectOkx(result: OkxAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "okx",
      title: "OKX 资产",
      body: "现货、资金与 Earn 只读账户",
    });
  }

  connectBitget(result: BitgetAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "bitget",
      title: "Bitget 资产",
      body: "现货、资金与 Earn 只读账户",
    });
  }
}

export interface TestServices extends AppServices {
  clock: FakeClock;
  cards: InMemoryCardStore;
  assetSources: FakeAssetSources;
  dailyAssetSnapshots: InMemoryDailyAssetSnapshots;
  assetSynchronization: FakeAssetSynchronization;
  prices: FakePrices;
  auth: SessionOwnerAuth;
  ownerCredentials: InMemoryOwnerCredentialStore;
  ownerRecoveryCredentials: InMemoryOwnerRecoveryCredentialStore;
  secrets: InMemorySecretStore;
  longbridge: FakeLongbridgeOAuth;
  longbridgeConnections: LongbridgeConnectionState;
  binance: FakeBinanceReadOnly;
  binanceConnections: BinanceConnectionState;
  okx: FakeOkxReadOnly;
  okxConnections: OkxConnectionState;
  bitget: FakeBitgetReadOnly;
  bitgetConnections: BitgetConnectionState;
  assetSourceConnections: InMemoryAssetSourceConnections;
}

export function createTestServices(): TestServices {
  const clock = new FakeClock();
  const cards = new InMemoryCardStore();
  const assetSources = new FakeAssetSources();
  const dailyAssetSnapshots = new InMemoryDailyAssetSnapshots();
  const secrets = new InMemorySecretStore();
  const prices = new FakePrices();
  const refreshAdapter = new FakeAssetSourceRefresher();
  const assetSynchronization = new FakeAssetSynchronization(
    new SourceIsolatedAssetSynchronization(
      assetSources,
      secrets,
      clock,
      refreshAdapter,
      100,
      dailyAssetSnapshots,
    ),
    refreshAdapter,
  );
  return {
    clock,
    cards,
    assetSources,
    dailyAssetSnapshots,
    assetSynchronization,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new InMemoryOwnerCredentialStore(),
    ownerRecoveryCredentials: new InMemoryOwnerRecoveryCredentialStore(),
    secrets,
    longbridge: new FakeLongbridgeOAuth(),
    longbridgeConnections: new LongbridgeConnectionState(),
    binance: new FakeBinanceReadOnly(prices),
    binanceConnections: new BinanceConnectionState(),
    okx: new FakeOkxReadOnly(),
    okxConnections: new OkxConnectionState(),
    bitget: new FakeBitgetReadOnly(),
    bitgetConnections: new BitgetConnectionState(),
    assetSourceConnections: new InMemoryAssetSourceConnections(
      assetSources,
      cards,
      secrets,
      dailyAssetSnapshots,
      clock,
    ),
  };
}
