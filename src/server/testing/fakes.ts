import type {
  AssetSourceSummary,
  AssetSourceLifecycle,
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
  EvmChain,
  EvmWatchAuthorizationResult,
  EvmWatchWalletReadOnly,
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
  DailyAssetSnapshot,
  DailyAssetSnapshots,
  LongbridgeAuthorizationResult,
  Card,
  AssetCardStore,
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
  LongbridgeOAuthState,
  mapLongbridgeSnapshot,
} from "@/server/asset-sources/longbridge";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import {
  mapBinanceSnapshot,
  validateBinanceReadOnlyPermissions,
} from "@/server/asset-sources/binance";
import {
  binanceFixture,
  binancePermissions,
} from "@/server/testing/binance-fixtures";
import {
  validateOkxReadOnlyPermission,
} from "@/server/asset-sources/okx";
import { okxFixtureSnapshot } from "@/server/testing/okx-fixtures";
import {
  validateBitgetReadOnlyPermission,
} from "@/server/asset-sources/bitget";
import { bitgetFixtureSnapshot } from "@/server/testing/bitget-fixtures";
import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";

export class FakeClock implements Clock {
  private current = new Date("2026-01-01T00:00:00.000Z");

  now(): Date {
    return this.current;
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export class InMemoryAssetCardStore implements AssetCardStore {
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

  removeSource(sourceId: string): void {
    this.snapshots = this.snapshots.flatMap((snapshot) => {
      const sources = snapshot.sources.filter((source) => source.sourceId !== sourceId);
      if (sources.length === 0) return [];
      const total = {
        USD: sources.some((source) => source.total.USD !== null)
          ? decimalAdd(...sources.flatMap((source) => source.total.USD ?? []))
          : null,
        CNY: sources.some((source) => source.total.CNY !== null)
          ? decimalAdd(...sources.flatMap((source) => source.total.CNY ?? []))
          : null,
      };
      return [{
        ...snapshot,
        sources,
        total,
        complete:
          sources.every((source) => source.complete) && total.USD !== null,
      }];
    });
  }
}

export interface FakeLongbridgeConfig {
  credentials: { accessToken: string; refreshToken: string };
  permissions: AssetPermission[];
  account: { id: string; label: string };
  accountPages: unknown[];
  positionPages: unknown[];
  previewError?: string;
  commitError?: string;
}

export class FakeLongbridgeOAuth implements LongbridgeOAuth {
  private config: FakeLongbridgeConfig | null = null;
  fetchedPositionPages = 0;

  configure(config: FakeLongbridgeConfig): void {
    this.config = config;
    this.fetchedPositionPages = 0;
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
    return {
      credentials: JSON.stringify(config.credentials),
      permissions: config.permissions,
      account: config.account,
      snapshot: mapLongbridgeSnapshot({
        accountPages: config.accountPages,
        positionPages,
        syncedAt: "2026-01-01T00:00:00.000Z",
      }),
    };
  }

  async revalidate() {
    return this.finish();
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

export class FakeEvmWatchWallet implements EvmWatchWalletReadOnly {
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  async preview(input: { chain: EvmChain; addresses: string[]; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    if (this.scenario === "failure") throw new Error("Ethereum RPC 暂时不可用");
    const addresses = input.addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
    if (addresses.length === 0 || addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) {
      throw new Error("Ethereum 地址格式无效");
    }
    if (new Set(addresses).size !== addresses.length) throw new Error("Ethereum 公开地址不能重复");
    const config = input.chain === "ethereum"
      ? { chainId: "1", label: "Ethereum", symbol: "ETH", standard: "ERC-20", nativePrice: "2000", nativeValue: "5000", total: "5519" }
      : { chainId: "56", label: "BNB Smart Chain", symbol: "BNB", standard: "BEP-20", nativePrice: "600", nativeValue: "1500", total: "2019" };
    const holdings = this.scenario === "empty" ? [] : [
      {
        symbol: config.symbol,
        name: config.label,
        sourceAsset: `evm:${config.chainId}:native`,
        quantity: "2.5",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: config.nativePrice, currency: "USD" },
        marketValue: config.nativeValue,
        sourceMarketValue: { amount: config.nativeValue, currency: "USD" },
        valuation: { status: "valued" as const, priceSource: `CoinGecko ${config.label}/USD 参考价格`, pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "SAME",
        name: `SAME · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        quantity: "500",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: "1", currency: "USD" },
        marketValue: "500",
        sourceMarketValue: { amount: "500", currency: "USD" },
        valuation: { status: "valued" as const, priceSource: "CoinGecko Ethereum token/USD 参考价格", pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "SAME",
        name: `SAME · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
        quantity: "10",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: "1.9", currency: "USD" },
        marketValue: "19",
        sourceMarketValue: { amount: "19", currency: "USD" },
        valuation: { status: "valued" as const, priceSource: "CoinGecko Ethereum token/USD 参考价格", pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "UNKNOWN",
        name: `UNKNOWN · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xcccccccccccccccccccccccccccccccccccccccc`,
        quantity: "7",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: { status: "unvalued" as const, reason: "CoinGecko 未返回可靠 USD 参考价格" },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
    ];
    return {
      credentials: JSON.stringify({ chain: input.chain, addresses }),
      chain: input.chain,
      permissions: ["public-address", "market-data", "positions"],
      account: {
        id: `evm:${config.chainId}:test-${addresses.length}`,
        label: `${config.label} 观察钱包 · ${addresses.length} 个地址`,
      },
      snapshot: {
        total: { amount: this.scenario === "empty" ? "0" : config.total, currency: "USD" },
        holdings,
        exchangeRates: [],
        syncedAt: input.observedAt,
      },
    };
  }

  revalidate(input: { credentials: string; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    const value = JSON.parse(input.credentials) as { chain: EvmChain; addresses: string[] };
    return this.preview({ chain: value.chain, addresses: value.addresses, observedAt: input.observedAt });
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
  | "bitget-refresh-failure"
  | "evm-ethereum-refresh-failure"
  | "evm-ethereum-price-refresh-failure"
  | "release-partial-failure";

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
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    const count = (this.sourceCalls.get(source.id) ?? 0) + 1;
    this.sourceCalls.set(source.id, count);
    if (this.scenario === "passthrough") {
      return { snapshot: source.snapshot };
    }
    if (this.scenario === "all-failure") {
      throw new Error("全部来源暂时不可用");
    }
    if (this.scenario === "release-partial-failure") {
      if (source.kind === "longbridge" || source.kind === "evm-watch-ethereum") {
        throw new Error(`${source.label} 发布验收模拟失败`);
      }
      return {
        snapshot: { ...source.snapshot, syncedAt: attemptedAt },
      };
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
    if (
      this.scenario === "evm-ethereum-refresh-failure" &&
      source.kind === "evm-watch-ethereum" &&
      mode !== "prices"
    ) {
      throw new Error("Ethereum 同步失败");
    }
    if (
      this.scenario === "evm-ethereum-price-refresh-failure" &&
      source.kind === "evm-watch-ethereum" &&
      mode === "prices"
    ) {
      throw new Error("Ethereum 定价失败");
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

  calls(): number {
    return [...this.sourceCalls.values()].reduce((total, count) => total + count, 0);
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
    private readonly cards: InMemoryAssetCardStore,
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
        title: config.title,
        body: config.body,
        sourceId,
        span: 1,
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

  connectEvm(result: EvmWatchAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: result.chain === "ethereum" ? "evm-watch-ethereum" : "evm-watch-bsc",
      title: result.chain === "ethereum" ? "Ethereum 观察钱包" : "BNB Smart Chain 观察钱包",
      body: result.chain === "ethereum"
        ? "公开地址 ETH 与 ERC-20 只读来源"
        : "公开地址 BNB 与 BEP-20 只读来源",
    });
  }
}

export class InMemoryAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly secrets: InMemorySecretStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
  ) {}

  async setHidden(sourceId: string, hidden: boolean): Promise<void> {
    if (!(await this.sources.list()).some((source) => source.id === sourceId)) {
      throw new Error("资产来源不存在");
    }
    const cards = await this.cards.list();
    const card = cards.find(
      (item) => item.kind === "asset" && item.sourceId === sourceId,
    );
    if (!card || card.kind !== "asset") throw new Error("资产卡片不存在");
    await this.cards.replaceAll(
      cards.map((item) => item.id === card.id ? { ...item, hidden } : item),
    );
  }

  async disconnect(sourceId: string): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    await this.sources.update({ ...source, lifecycle: "disconnected" });
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
  }

  async deleteData(sourceId: string): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    await this.sources.replaceAll(sources.filter((item) => item.id !== sourceId));
    await this.cards.replaceAll(
      (await this.cards.list()).filter(
        (card) => card.kind !== "asset" || card.sourceId !== sourceId,
      ),
    );
    this.dailySnapshots.removeSource(sourceId);
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
  }
}

export interface TestServices extends AppServices {
  clock: FakeClock;
  assetCards: InMemoryAssetCardStore;
  assetSources: FakeAssetSources;
  dailyAssetSnapshots: InMemoryDailyAssetSnapshots;
  assetSynchronization: FakeAssetSynchronization;
  prices: FakePrices;
  auth: SessionOwnerAuth;
  ownerCredentials: InMemoryOwnerCredentialStore;
  ownerRecoveryCredentials: InMemoryOwnerRecoveryCredentialStore;
  secrets: InMemorySecretStore;
  longbridge: FakeLongbridgeOAuth;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance: FakeBinanceReadOnly;
  okx: FakeOkxReadOnly;
  bitget: FakeBitgetReadOnly;
  evm: FakeEvmWatchWallet;
  assetSourceConnections: InMemoryAssetSourceConnections;
  assetSourceOnboarding: AssetSourceOnboarding;
  assetSourceLifecycle: InMemoryAssetSourceLifecycle;
}

export function createTestServices(): TestServices {
  const clock = new FakeClock();
  const assetCards = new InMemoryAssetCardStore();
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
  const assetSourceLifecycle = new InMemoryAssetSourceLifecycle(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
  );
  const longbridge = new FakeLongbridgeOAuth();
  const binance = new FakeBinanceReadOnly(prices);
  const okx = new FakeOkxReadOnly();
  const bitget = new FakeBitgetReadOnly();
  const evm = new FakeEvmWatchWallet();
  const assetSourceConnections = new InMemoryAssetSourceConnections(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
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
    assetCards,
    assetSources,
    assetSourceLifecycle,
    dailyAssetSnapshots,
    assetSynchronization,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new InMemoryOwnerCredentialStore(),
    ownerRecoveryCredentials: new InMemoryOwnerRecoveryCredentialStore(),
    secrets,
    longbridge,
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
    evm,
    assetSourceConnections,
    assetSourceOnboarding,
    businessDataBackups: {
      async exportBackup() {
        throw new Error("内存测试服务不提供本地备份文件");
      },
      async previewRestore() {
        throw new Error("内存测试服务不提供本地备份文件");
      },
      async restore() {
        throw new Error("内存测试服务不提供本地备份文件");
      },
    },
  };
}
