import type {
  AssetSourceSummary,
  AssetSources,
  AssetPermission,
  AssetSourceConnections,
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
        exchangeRatePages: config.exchangeRatePages,
        profitPages,
      }),
    };
  }
}

export class FakePrices implements Prices {
  async quote(): Promise<PriceQuote | null> {
    return null;
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
  ) {}

  failNext(message: string | undefined): void {
    this.failMessage = message ?? null;
  }

  async connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void> {
    const credentialReference = await this.secrets.put(result.credentials);
    if (this.failMessage) {
      const message = this.failMessage;
      this.failMessage = null;
      await this.secrets.remove(credentialReference);
      throw new Error(message);
    }
    const sourceId = `test-longbridge-source-${(await this.sources.list()).length + 1}`;
    await this.sources.replaceAll([
      ...(await this.sources.list()),
      {
        id: sourceId,
        kind: "longbridge",
        label: result.account.label,
        accountId: result.account.id,
        permissions: result.permissions,
        credentialReference,
        snapshot: result.snapshot,
      },
    ]);
    await this.cards.replaceAll([
      ...(await this.cards.list()),
      {
        id: `test-longbridge-card-${sourceId}`,
        kind: "asset",
        access: "private",
        title: "长桥资产",
        body: "只读证券账户",
        sourceId,
        span: 2,
      },
    ]);
  }
}

export interface TestServices extends AppServices {
  clock: FakeClock;
  cards: InMemoryCardStore;
  assetSources: FakeAssetSources;
  prices: FakePrices;
  auth: SessionOwnerAuth;
  ownerCredentials: InMemoryOwnerCredentialStore;
  ownerRecoveryCredentials: InMemoryOwnerRecoveryCredentialStore;
  secrets: InMemorySecretStore;
  longbridge: FakeLongbridgeOAuth;
  longbridgeConnections: LongbridgeConnectionState;
  assetSourceConnections: InMemoryAssetSourceConnections;
}

export function createTestServices(): TestServices {
  const clock = new FakeClock();
  const cards = new InMemoryCardStore();
  const assetSources = new FakeAssetSources();
  const secrets = new InMemorySecretStore();
  return {
    clock,
    cards,
    assetSources,
    prices: new FakePrices(),
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new InMemoryOwnerCredentialStore(),
    ownerRecoveryCredentials: new InMemoryOwnerRecoveryCredentialStore(),
    secrets,
    longbridge: new FakeLongbridgeOAuth(),
    longbridgeConnections: new LongbridgeConnectionState(),
    assetSourceConnections: new InMemoryAssetSourceConnections(
      assetSources,
      cards,
      secrets,
    ),
  };
}
