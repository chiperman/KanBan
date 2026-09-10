import type {
  AssetSourceSummary,
  AssetSourceLifecycle,
  AssetSources,
  AssetPermission,
  AssetSourceConnections,
  BitAuthorizationResult,
  BitReadOnly,
  CreateManualAssetSourceInput,
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshScope,
  AssetSourceRefresher,
  AssetSynchronization,
  BinanceAuthorizationResult,
  BinanceReadOnly,
  BitgetAuthorizationResult,
  BitgetAccountMode,
  BitgetReadOnly,
  EvmChain,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
  EvmWatchAuthorizationResult,
  EvmWatchWalletReadOnly,
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
  DailyAssetSnapshot,
  DailyAssetSourceSnapshot,
  DailyAssetSnapshots,
  ImportedAssetSourceHistoryObservation,
  FormalDailySettlement,
  FormalDailySettlementRunner,
  FormalDailySettlements,
  InvestmentCashflow,
  LongbridgeBenchmarkCandlestickReader,
  LongbridgeBenchmarkCandlestick,
  LongbridgeBenchmarkSymbol,
  LongbridgeAuthorizationResult,
  LongbridgeHoldingCandlestickReader,
  LongbridgeHoldingCandlestick,
  LongbridgeHoldingCandlestickPeriod,
  LongbridgeHoldingCandlePeriod,
  LongbridgeHoldingTrendPoint,
  Card,
  AssetCardStore,
  AssetFullRefreshState,
  Clock,
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  Prices,
  PriceQuote,
  SecretStore,
  LongbridgeOAuth,
  ManualAssetRecordInput,
  ManualAssetRecord,
  ManualAssetRecords,
} from "@/server/ports";
import type { AppServices } from "@/server/composition";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { updateEvmTokenPreferences } from "@/domain/evm-token-preferences";
import {
  LongbridgeOAuthState,
  mapLongbridgeSnapshot,
} from "@/server/asset-sources/longbridge";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import {
  buildDailyAssetSnapshot,
  mergeDailyTrendObservation,
  shanghaiDay,
} from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
import { assertManualAssetRecordNotFuture } from "@/domain/manual-asset-records";
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
import {
  InvestmentCashflowLedger,
  type InvestmentCashflowStore,
} from "@/server/investment-cashflows";

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

export class InMemoryInvestmentCashflowStore
  implements InvestmentCashflowStore
{
  private cashflows: InvestmentCashflow[] = [];

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return structuredClone(this.cashflows);
  }

  async createInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void> {
    this.cashflows.push(structuredClone(cashflow));
  }

  async updateInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void> {
    const index = this.cashflows.findIndex(({ id }) => id === cashflow.id);
    if (index === -1) throw new Error("资金记录不存在");
    this.cashflows[index] = structuredClone(cashflow);
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    const count = this.cashflows.length;
    this.cashflows = this.cashflows.filter((cashflow) => cashflow.id !== id);
    if (this.cashflows.length === count) throw new Error("资金记录不存在");
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
  private trendObservations: DailyAssetSnapshot[] = [];
  private importedSourceHistoryObservations:
    ImportedAssetSourceHistoryObservation[] = [];

  async list(): Promise<DailyAssetSnapshot[]> {
    return this.snapshots;
  }

  async listTrendObservations(): Promise<DailyAssetSnapshot[]> {
    return this.trendObservations;
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return structuredClone(this.importedSourceHistoryObservations);
  }

  async createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean> {
    const existing = this.snapshots.find(({ day }) => day === snapshot.day);
    if (existing) return false;
    this.snapshots = [...this.snapshots, snapshot].sort((left, right) =>
      left.day.localeCompare(right.day),
    );
    this.trendObservations = [
      ...this.trendObservations,
      structuredClone(snapshot),
    ].sort((left, right) => left.day.localeCompare(right.day));
    return true;
  }

  async record(snapshot: DailyAssetSnapshot, createBaseline: boolean): Promise<void> {
    const baselineIndex = this.snapshots.findIndex(
      ({ day }) => day === snapshot.day,
    );
    if (createBaseline && baselineIndex === -1) {
      await this.createIfAbsent(snapshot);
    } else if (
      createBaseline &&
      this.snapshots[baselineIndex].status === "expired"
    ) {
      this.snapshots[baselineIndex] = structuredClone(snapshot);
    }
    const index = this.trendObservations.findIndex(({ day }) => day === snapshot.day);
    if (index === -1) return;
    this.trendObservations[index] = mergeDailyTrendObservation(
      this.trendObservations[index],
      snapshot,
      !createBaseline,
    );
  }

  async recordManual(
    source: DailyAssetSourceSnapshot,
    day: string,
    currentObservation: DailyAssetSnapshot | null,
  ): Promise<void> {
    const replaceManualSource = (
      previous: DailyAssetSnapshot,
    ): DailyAssetSnapshot => {
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
    };
    const baselineIndex = this.snapshots.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (baselineIndex === -1) {
      const snapshot = currentObservation === null
        ? {
            day,
            capturedAt: source.capturedAt,
            exchangeRates: [],
            complete: false,
            status: "incomplete" as const,
            total: source.total,
            sources: [source],
          }
        : replaceManualSource(currentObservation);
      this.snapshots = [...this.snapshots, structuredClone(snapshot)].sort(
        (left, right) => left.day.localeCompare(right.day),
      );
    }
    const trendIndex = this.trendObservations.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (trendIndex === -1) {
      const snapshot = currentObservation === null
        ? {
            day,
            capturedAt: source.capturedAt,
            exchangeRates: [],
            complete: false,
            status: "incomplete" as const,
            total: source.total,
            sources: [source],
          }
        : replaceManualSource(currentObservation);
      this.trendObservations = [...this.trendObservations, structuredClone(snapshot)]
        .sort((left, right) => left.day.localeCompare(right.day));
    } else {
      this.trendObservations[trendIndex] = replaceManualSource(
        this.trendObservations[trendIndex],
      );
    }
  }

  removeSource(sourceId: string): void {
    const remove = (snapshot: DailyAssetSnapshot): DailyAssetSnapshot | null => {
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
    };
    this.snapshots = this.snapshots.flatMap((snapshot) => {
      const updated = remove(snapshot);
      return updated ? [updated] : [];
    });
    this.trendObservations = this.trendObservations.flatMap((snapshot) => {
      const updated = remove(snapshot);
      return updated ? [updated] : [];
    });
  }
}

export class InMemoryAssetFullRefreshState implements AssetFullRefreshState {
  private attemptedAt: string | null = null;
  private inProgressAt: string | null = null;

  async read() {
    return { attemptedAt: this.attemptedAt, inProgressAt: this.inProgressAt };
  }

  async initialize(attemptedAt: string): Promise<boolean> {
    if (this.attemptedAt !== null) return false;
    this.attemptedAt = attemptedAt;
    return true;
  }

  async claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    const now = Date.parse(input.attemptedAt);
    const inProgress = this.inProgressAt === null
      ? Number.NaN
      : Date.parse(this.inProgressAt);
    if (
      this.inProgressAt !== null &&
      Number.isFinite(now) &&
      Number.isFinite(inProgress) &&
      now - inProgress < input.staleAfterMs
    ) {
      return "in-progress";
    }
    const previous = this.attemptedAt === null
      ? Number.NaN
      : Date.parse(this.attemptedAt);
    if (
      !input.force &&
      Number.isFinite(now) &&
      Number.isFinite(previous) &&
      now - previous < input.intervalMs
    ) {
      return "not-due";
    }
    this.attemptedAt = input.attemptedAt;
    this.inProgressAt = input.attemptedAt;
    return "claimed";
  }

  async start(attemptedAt: string): Promise<void> {
    this.attemptedAt = attemptedAt;
    this.inProgressAt = attemptedAt;
  }

  async finish(attemptedAt?: string): Promise<void> {
    if (attemptedAt === undefined || this.inProgressAt === attemptedAt) {
      this.inProgressAt = null;
    }
  }

  async clear(): Promise<void> {
    this.attemptedAt = null;
    this.inProgressAt = null;
  }
}

export class InMemoryFormalDailySettlements implements FormalDailySettlements {
  private settlements: FormalDailySettlement[] = [];

  async list(): Promise<FormalDailySettlement[]> {
    return structuredClone(this.settlements);
  }

  async recordIfAbsent(settlement: FormalDailySettlement): Promise<boolean> {
    if (
      this.settlements.some(
        (existing) => existing.anchor.key === settlement.anchor.key,
      )
    ) {
      return false;
    }
    this.settlements = [structuredClone(settlement), ...this.settlements];
    return true;
  }
}

class NotDueFormalDailySettlementRunner implements FormalDailySettlementRunner {
  async run() {
    return { outcome: "not-due" as const };
  }
}

export class InMemoryManualAssetRecords implements ManualAssetRecords {
  private records: ManualAssetRecord[] = [];
  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly clock: Clock,
  ) {}

  async create(input: CreateManualAssetSourceInput): Promise<void> {
    const sourceId = `test-manual-source-${(await this.sources.list()).length + 1}`;
    const capturedAt = this.clock.now().toISOString();
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
    const sources = [...(await this.sources.list()), source];
    await this.sources.replaceAll(sources);
    await this.cards.replaceAll([
      ...(await this.cards.list()),
      {
        id: `test-manual-card-${sourceId}`,
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      },
    ]);
  }

  async record(
    sourceId: string,
    input: ManualAssetRecordInput,
  ): Promise<void> {
    const capturedAt = this.clock.now().toISOString();
    assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产记录可以编辑今日总额");
    }
    const record: ManualAssetRecord = { sourceId, ...input, recordedAt: capturedAt };
    this.records = [
      ...this.records.filter(
        (record) => record.sourceId !== sourceId || record.day !== input.day,
      ),
      record,
    ];
    const latest = this.records
      .filter((record) => record.sourceId === sourceId)
      .toSorted((left, right) => right.day.localeCompare(left.day))[0]!;
    const updatedManualSource = {
      ...source,
      hasManualRecord: true,
      snapshot: {
        ...source.snapshot,
        total: { amount: latest.amount, currency: latest.currency },
        syncedAt: latest.recordedAt,
      },
      sync: {
        status: "current" as const,
        lastSuccessfulAt: capturedAt,
        lastAttemptAt: capturedAt,
        error: null,
        failedMode: null,
      },
    };
    const updatedSources = sources.map((item) =>
      item.id === sourceId ? updatedManualSource : item,
    );
    await this.sources.replaceAll(updatedSources);
    const currentObservation = input.day === shanghaiDay(capturedAt)
      ? buildDailyAssetSnapshot(updatedSources, capturedAt)
      : null;
    const manualSource: DailyAssetSourceSnapshot = currentObservation?.sources.find(
      (item) => item.sourceId === sourceId,
    ) ?? {
      sourceId,
      label: updatedManualSource.label,
      kind: "manual",
      capturedAt: record.recordedAt,
      complete: true,
      status: "complete",
      total: {
        USD: record.currency === "USD" ? record.amount : null,
        CNY: record.currency === "CNY" ? record.amount : null,
        HKD: record.currency === "HKD" ? record.amount : null,
      },
    };
    await this.dailySnapshots.recordManual(
      manualSource,
      input.day,
      currentObservation,
    );
  }

  async list(): Promise<ManualAssetRecord[]> {
    return this.records.toSorted((left, right) =>
      left.sourceId.localeCompare(right.sourceId) || right.day.localeCompare(left.day),
    );
  }

  async delete(sourceId: string, day: string): Promise<void> {
    const index = this.records.findIndex(
      (record) => record.sourceId === sourceId && record.day === day,
    );
    if (index === -1) throw new Error("指定日期没有手工资产记录");
    this.records.splice(index, 1);
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source || source.kind !== "manual") throw new Error("只有手工资产记录可以删除");
    const latest = this.records
      .filter((record) => record.sourceId === sourceId)
      .toSorted((left, right) => right.day.localeCompare(left.day))[0];
    await this.sources.replaceAll(sources.map((item) => item.id !== sourceId ? item : {
      ...item,
      hasManualRecord: latest !== undefined,
      snapshot: { ...item.snapshot, total: latest ? { amount: latest.amount, currency: latest.currency } : { amount: "0", currency: "CNY" } },
    }));
  }
}

export interface FakeLongbridgeConfig {
  credentials: { accessToken: string; refreshToken: string };
  permissions: AssetPermission[];
  account: { id: string; label: string };
  accountPages: unknown[];
  positionPages: unknown[];
  quotes?: Array<{
    symbol: string;
    lastDone: string;
    prevClose: string;
    timestamp: number;
  }>;
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
        quotes: config.quotes,
        syncedAt: "2026-01-01T00:00:00.000Z",
      }),
    };
  }

  async revalidate() {
    return this.finish();
  }
}

export class FakeLongbridgeHoldingCandlestickReader
  implements LongbridgeHoldingCandlestickReader
{
  readonly reads: Array<{
    sourceId: string;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }> = [];
  readonly trendReads: Array<{ sourceId: string; symbol: string }> = [];

  async readCandlesticks(input: {
    source: AssetSourceSummary;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }): Promise<LongbridgeHoldingCandlestick[]> {
    this.reads.push({
      sourceId: input.source.id,
      symbol: input.symbol,
      period: input.period,
    });
    const count = 12;
    const minuteStep = input.period === "min-1" ? 60_000 : 86_400_000;
    const start = Date.parse("2026-08-10T13:30:00.000Z");
    return Array.from({ length: count }, (_, index) => {
      const open = 200 + index * 1.25;
      const close = open + (index % 2 === 0 ? 0.75 : -0.5);
      return {
        time: new Date(start + index * minuteStep).toISOString(),
        open: open.toFixed(2),
        high: (Math.max(open, close) + 0.8).toFixed(2),
        low: (Math.min(open, close) - 0.7).toFixed(2),
        close: close.toFixed(2),
        volume: String(1_000_000 + index * 45_000),
        turnover: String(200_000_000 + index * 9_000_000),
      };
    });
  }

  async readFiveDayTrend(input: {
    source: AssetSourceSummary;
    symbol: string;
  }): Promise<LongbridgeHoldingTrendPoint[]> {
    this.trendReads.push({ sourceId: input.source.id, symbol: input.symbol });
    const dates = [
      "2026-08-21",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ];
    return dates.flatMap((date, dayIndex) =>
      Array.from({ length: 78 }, (_, minuteIndex) => {
        const price = 200 + dayIndex * 1.5 + minuteIndex * 0.08;
        return {
          time: new Date(
            Date.parse(`${date}T13:30:00.000Z`) + minuteIndex * 300_000,
          ).toISOString(),
          price: price.toFixed(2),
        };
      }),
    );
  }
}

export class FakeLongbridgeBenchmarkCandlestickReader
  implements LongbridgeBenchmarkCandlestickReader
{
  readonly reads: Array<{ count: number; symbol: LongbridgeBenchmarkSymbol }> = [];

  async readDailyCandlesticks(input: {
    count: number;
    symbol: LongbridgeBenchmarkSymbol;
  }): Promise<LongbridgeBenchmarkCandlestick[]> {
    this.reads.push(input);
    const start = Date.parse("2026-03-01T20:00:00.000Z");
    const base = input.symbol === ".SPX.US" ? 5_800 : 20_000;
    const step = input.symbol === ".SPX.US" ? 2.75 : 11.5;
    return Array.from({ length: 180 }, (_, index) => ({
      close: (base + index * step).toFixed(2),
      time: new Date(start + index * 86_400_000).toISOString(),
    })).slice(-input.count);
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
    const fixture = binanceFixture(
      this.scenario === "missing-price",
      false,
      this.scenario === "dust",
    );
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
        spotCostPrices: new Map([["BTC", "50050"]]),
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
      snapshot: bitgetFixtureSnapshot(input.observedAt, input.accountMode),
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

export class FakeBitReadOnly implements BitReadOnly {
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private snapshot(observedAt: string) {
    const dcpOrdersAvailable = this.scenario !== "dcp-orders-failure";
    return {
      total: { amount: "160", currency: "USD" },
      holdings: [
        {
          symbol: "USDT",
          name: "USDT · Wallet",
          sourceAsset: "bit:wallet:USDT",
          sourceAccount: "wallet" as const,
          sourceProduct: "wallet",
          quantity: "100",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "100",
          sourceMarketValue: { amount: "100", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT Wallet USD 计价",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "USDT",
          name: "USDT · Balance+",
          sourceAsset: "bit:balance-plus:USDT",
          sourceAccount: "earn" as const,
          sourceProduct: "balance-plus",
          quantity: "30",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "30",
          sourceMarketValue: { amount: "30", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT Balance+ USD 计价",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "USD",
          name: "DCP（USD 总头寸）",
          sourceAsset: "bit:dcp:aggregate",
          sourceAccount: "earn" as const,
          sourceProduct: "dcp",
          providerPositionId: "aggregate",
          quantity: "30",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "30",
          sourceMarketValue: { amount: "30", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT DCP USD 汇总",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        ...(dcpOrdersAvailable ? [{
          symbol: "USDT",
          name: "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
          sourceAsset: "bit:dcp:order:7125082312731329000",
          sourceAccount: "earn" as const,
          sourceProduct: "dcp",
          providerPositionId: "7125082312731329000",
          providerPositionState: "进行中",
          quantity: "30",
          currency: "USDT",
          assetClass: "crypto" as const,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "quote-unavailable" as const,
            reason: "BIT / Matrixport DCP 已含入 USD 总头寸，订单级当前估值未提供",
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        }] : []),
      ],
      exchangeRates: [],
      syncedAt: observedAt,
      coverage: {
        status: "complete" as const,
        totalIsAuthoritative: false,
        products: [
          {
            product: "wallet",
            capability: "detailed" as const,
            freshness: "current" as const,
            message: "余额明细已读取；未估值币种不会按零计入总额",
          },
          {
            product: "balance-plus",
            capability: "detailed" as const,
            freshness: "current" as const,
            message: "逐币余额；total_balance_amount 未作为总资产口径",
          },
          dcpOrdersAvailable
            ? {
              product: "dcp",
              capability: "detailed" as const,
              freshness: "current" as const,
              message: "已读取 1 个活跃订单；总额仍以平台 USD 总头寸为准",
            }
            : {
              product: "dcp",
              capability: "aggregate-only" as const,
              freshness: "current" as const,
              message: "订单明细本次未读取；保留 USD 总头寸",
            },
        ],
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
    };
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    userId: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    if (this.scenario === "failure") {
      return Promise.reject(new Error("BIT Wallet 暂时不可用"));
    }
    if (!/^\d+$/.test(input.userId)) {
      return Promise.reject(new Error("BIT 用户 ID 格式无效"));
    }
    const userId = this.scenario === "identity-changed" ? "609999" : input.userId;
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        userId: input.userId,
      }),
      permissions: ["account", "positions"],
      account: {
        id: `bit:${userId}`,
        label: `BIT / Matrixport 账户 · UID ${userId}`,
      },
      snapshot: this.snapshot(input.observedAt),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      userId: string;
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
    const holdings: EvmWatchAuthorizationResult["snapshot"]["holdings"] = this.scenario === "empty" ? [] : [
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
    const hasLidoWithdrawal = this.scenario === "lido-withdrawal" && config.chainId === "1";
    const hasListaWithdrawal =
      this.scenario === "lista-slisbnb-withdrawal" && config.chainId === "56";
    if (hasLidoWithdrawal) {
      const unknownIndex = holdings.findIndex(({ symbol }) => symbol === "UNKNOWN");
      if (unknownIndex >= 0) holdings.splice(unknownIndex, 1);
      holdings.push(
        {
          symbol: "ETH",
          name: "Lido 提现申请 #18",
          sourceAsset: "evm:1:lido-withdrawal:18",
          sourceAccount: "wallet",
          sourceProduct: "lido-withdrawal-request",
          providerPositionId: "18",
          providerPositionState: "排队中",
          economicAssetKey: "lido-withdrawal:18",
          positionState: "redeeming",
          quantity: "1.5",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "2000", currency: "USD" },
          marketValue: "3000",
          sourceMarketValue: { amount: "3000", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko Ethereum/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "ETH",
          name: "Lido 提现申请 #27",
          sourceAsset: "evm:1:lido-withdrawal:27",
          sourceAccount: "wallet",
          sourceProduct: "lido-withdrawal-request",
          providerPositionId: "27",
          providerPositionState: "可领取",
          economicAssetKey: "lido-withdrawal:27",
          positionState: "redeeming",
          quantity: "0.49",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "2000", currency: "USD" },
          marketValue: "980",
          sourceMarketValue: { amount: "980", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko Ethereum/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      );
    }
    if (hasListaWithdrawal) {
      const unknownIndex = holdings.findIndex(({ symbol }) => symbol === "UNKNOWN");
      if (unknownIndex >= 0) {
        holdings.splice(unknownIndex, 1, {
          symbol: "slisBNB",
          name: "slisBNB · BNB Smart Chain BEP-20",
          sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
          quantity: "2",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "620", currency: "USD" },
          marketValue: "1240",
          sourceMarketValue: { amount: "1240", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain slisBNB/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        });
      }
      holdings.push(
        {
          symbol: "BNB",
          name: "Lista slisBNB 提现申请 #101",
          sourceAsset: "evm:56:lista-slisbnb-withdrawal:101",
          sourceAccount: "wallet",
          sourceProduct: "lista-slisbnb-withdrawal-request",
          providerPositionId: "101",
          providerPositionState: "锁仓中",
          providerPositionAvailableOn: "2026-08-27",
          economicAssetKey: "lista-slisbnb-withdrawal:101",
          positionState: "redeeming",
          quantity: "1.2",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "600", currency: "USD" },
          marketValue: "720",
          sourceMarketValue: { amount: "720", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "BNB",
          name: "Lista slisBNB 提现申请 #102",
          sourceAsset: "evm:56:lista-slisbnb-withdrawal:102",
          sourceAccount: "wallet",
          sourceProduct: "lista-slisbnb-withdrawal-request",
          providerPositionId: "102",
          providerPositionState: "可领取",
          economicAssetKey: "lista-slisbnb-withdrawal:102",
          positionState: "redeeming",
          quantity: "2.45",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "600", currency: "USD" },
          marketValue: "1470",
          sourceMarketValue: { amount: "1470", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      );
    }
    const unrecognizedEvmTokens =
      this.scenario === "metadata-decimals-failure" && config.chainId === "1"
        ? [{
          sourceAsset: "evm:1:0x889edc2edab5f40e902b864ad4d7ade8e412f9b1",
          symbol: "unstETH",
          name: "unstETH",
          quantity: null,
          reason: "代币合约未返回可靠 decimals，数量无法读取",
        }]
        : [];
    return {
      credentials: JSON.stringify({ chain: input.chain, addresses }),
      chain: input.chain,
      permissions: ["public-address", "market-data", "positions"],
      account: {
        id: `evm:${config.chainId}:test-${[...addresses].sort().join(",")}`,
        label: `${config.label} 观察钱包 · ${addresses.length} 个地址`,
      },
      snapshot: {
        total: {
          amount: this.scenario === "empty"
            ? "0"
            : hasLidoWithdrawal
              ? "9499"
              : hasListaWithdrawal
                ? "5449"
              : config.total,
          currency: "USD",
        },
        holdings,
        ...(unrecognizedEvmTokens.length > 0 ? { unrecognizedEvmTokens } : {}),
        ...(hasLidoWithdrawal || hasListaWithdrawal
          ? {
              coverage: {
                status: "complete" as const,
                products: [{
                  product: hasLidoWithdrawal
                    ? "lido-withdrawal-request"
                    : "lista-slisbnb-withdrawal-request",
                  capability: "detailed" as const,
                  freshness: "current" as const,
                  message: hasLidoWithdrawal
                    ? "已读取 2 笔未领取申请 · 1 笔排队中、1 笔可领取"
                    : "已读取 2 笔未领取申请 · 1 笔锁仓中、1 笔可领取",
                }],
                unexplainedValue: null,
                excludedPositiveAccounts: [],
              },
            }
          : {}),
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
  | "bit-refresh-failure"
  | "evm-ethereum-refresh-failure"
  | "evm-ethereum-price-refresh-failure"
  | "evm-unknown-valued"
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
      this.scenario === "bit-refresh-failure" &&
      source.kind === "bit"
    ) {
      throw new Error("BIT 同步失败");
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
    if (
      this.scenario === "evm-unknown-valued" &&
      source.kind === "evm-watch-ethereum"
    ) {
      const holdings = source.snapshot.holdings.map((holding) =>
        holding.sourceAsset ===
            "evm:1:0xcccccccccccccccccccccccccccccccccccccccc"
          ? {
              ...holding,
              currentPrice: { amount: "1", currency: "USD" },
              marketValue: holding.quantity,
              sourceMarketValue: {
                amount: holding.quantity,
                currency: "USD",
              },
              valuation: {
                status: "valued" as const,
                priceSource: "CoinGecko Ethereum token/USD 参考价格",
                pricedAt: attemptedAt,
              },
            }
          : holding
      );
      return {
        snapshot: {
          ...source.snapshot,
          total: {
            amount: decimalAdd(source.snapshot.total.amount, "7"),
            currency: "USD",
          },
          holdings,
          syncedAt: attemptedAt,
        },
      };
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
  readonly scopes: AssetRefreshScope[] = [];
  readonly sourceIds: Array<string | null> = [];
  active = 0;
  private holdNext = false;
  private releasePending: (() => void) | null = null;

  constructor(
    private readonly delegate: SourceIsolatedAssetSynchronization,
    readonly refresher: FakeAssetSourceRefresher,
  ) {}

  reset(scenario: FakeRefreshScenario): void {
    this.modes.length = 0;
    this.scopes.length = 0;
    this.sourceIds.length = 0;
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

  async request(
    input: import("@/server/ports").AssetRefreshRequest,
  ): Promise<AssetRefreshReport> {
    const { intent } = input;
    const sourceIds = input.sourceIds ?? (
      intent.reason === "manual-source" ? [intent.sourceId] : undefined
    );
    this.modes.push("all");
    this.scopes.push("all");
    this.sourceIds.push(sourceIds?.[0] ?? null);
    this.active += 1;
    try {
      if (this.holdNext) {
        this.holdNext = false;
        await new Promise<void>((resolve) => {
          this.releasePending = resolve;
        });
      }
      return await this.delegate.request(input);
    } finally {
      this.active -= 1;
    }
  }

  async refresh(
    mode: AssetRefreshMode,
    scope: AssetRefreshScope = "all",
    sourceId?: string,
  ): Promise<AssetRefreshReport> {
    this.modes.push(mode);
    this.scopes.push(scope);
    this.sourceIds.push(sourceId ?? null);
    this.active += 1;
    try {
      if (this.holdNext) {
        this.holdNext = false;
        await new Promise<void>((resolve) => {
          this.releasePending = resolve;
        });
      }
      return await this.delegate.refresh(mode, scope, sourceId);
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

  async claimTotpCounter(counter: string): Promise<boolean> {
    if (!this.credential) return false;
    const previous = this.credential.lastUsedTotpCounter;
    if (previous !== null && BigInt(counter) <= BigInt(previous)) return false;
    this.credential = { ...this.credential, lastUsedTotpCounter: counter };
    return true;
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

export class InMemoryExternalServiceConfiguration
  implements ExternalServiceConfiguration
{
  private coinGeckoDemoApiKeyValue: string | null = null;
  private ethereumRpcUrl: string | null = null;
  private bscRpcUrl: string | null = null;
  private verifiedAt: string | null = null;

  constructor(private readonly clock: Clock) {}

  async status(): Promise<ExternalServiceConfigurationStatus> {
    return {
      coinGecko: {
        configured: this.coinGeckoDemoApiKeyValue !== null,
        verifiedAt: this.coinGeckoDemoApiKeyValue === null ? null : this.verifiedAt,
      },
      ethereumRpc: {
        configured: this.ethereumRpcUrl !== null,
        verifiedAt: this.ethereumRpcUrl === null ? null : this.verifiedAt,
      },
      bscRpc: {
        configured: this.bscRpcUrl !== null,
        verifiedAt: this.bscRpcUrl === null ? null : this.verifiedAt,
      },
    };
  }

  async saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus> {
    const key = input.coinGeckoDemoApiKey?.trim() || this.coinGeckoDemoApiKeyValue;
    const ethereum = input.ethereumRpcUrl?.trim() || this.ethereumRpcUrl;
    const bsc = input.bscRpcUrl?.trim() || this.bscRpcUrl;
    if (!key || !ethereum || !bsc) {
      throw new Error("请一次配置 CoinGecko、Ethereum RPC 与 BSC RPC");
    }
    for (const [label, value] of [
      ["Ethereum RPC URL", ethereum],
      ["BSC RPC URL", bsc],
    ] as const) {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        throw new Error(`${label} 必须使用 HTTPS`);
      }
    }
    this.coinGeckoDemoApiKeyValue = key;
    this.ethereumRpcUrl = ethereum;
    this.bscRpcUrl = bsc;
    this.verifiedAt = this.clock.now().toISOString();
    return this.status();
  }

  async coinGeckoDemoApiKey(): Promise<string | null> {
    return this.coinGeckoDemoApiKeyValue;
  }

  async rpcUrl(chain: EvmChain): Promise<string | null> {
    return chain === "ethereum" ? this.ethereumRpcUrl : this.bscRpcUrl;
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
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  failNext(message: string | undefined): void {
    this.failMessage = message ?? null;
  }

  private async connect(
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | BitAuthorizationResult
      | EvmWatchAuthorizationResult,
    config: { kind: string; title: string; body: string },
    reconnectSourceId?: string,
  ): Promise<void> {
    const credentialReference = await this.secrets.put(result.credentials);
    if (this.failMessage) {
      const message = this.failMessage;
      this.failMessage = null;
      await this.secrets.remove(credentialReference);
      throw new Error(message);
    }
    const currentSources = await this.sources.list();
    const existing = reconnectSourceId
      ? currentSources.find((source) => source.id === reconnectSourceId)
      : currentSources.find(
          (source) =>
            source.kind === config.kind && source.accountId === result.account.id,
        );
    if (reconnectSourceId) {
      if (!existing || existing.kind !== config.kind) {
        await this.secrets.remove(credentialReference);
        throw new Error("EVM 观察钱包不存在或链不匹配");
      }
    }
    const sourceId =
      existing?.id ??
      `test-${config.kind}-source-${currentSources.length + 1}`;
    const connected: AssetSourceSummary = {
      ...(existing ?? {}),
      id: sourceId,
      kind: config.kind,
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
    const updatedSources: AssetSourceSummary[] = existing
      ? currentSources.map((source) =>
          source.id === sourceId ? connected : source,
        )
      : [
          ...currentSources,
          {
        id: sourceId,
            kind: config.kind,
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
          },
        ];
    await this.sources.replaceAll(updatedSources);
    if (!existing) {
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
    }
    const isFirstAutomaticSource = !currentSources.some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const observation = buildDailyAssetSnapshot(
      updatedSources,
      this.clock.now().toISOString(),
    );
    if (isFirstAutomaticSource && observation.complete) {
      await this.dailySnapshots.record(observation, true);
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(this.clock.now().toISOString());
    }
    const previousReference = existing?.credentialReference ?? null;
    if (
      previousReference !== null &&
      previousReference !== credentialReference
    ) {
      await this.secrets.remove(previousReference);
    }
  }

  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "longbridge",
      title: "长桥资产",
      body: "只读证券账户",
    });
  }

  reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void> {
    return this.connect(
      result,
      {
        kind: "longbridge",
        title: "长桥资产",
        body: "只读证券账户",
      },
      sourceId,
    );
  }

  connectBinance(result: BinanceAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "binance",
      title: "Binance 资产",
      body: "投资产品明细、钱包守恒与覆盖状态",
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

  connectBit(result: BitAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "bit",
      title: "BIT / Matrixport 资产",
      body: "Wallet 与理财产品只读账户",
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

  reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void> {
    return this.connect(
      result,
      {
        kind: result.chain === "ethereum"
          ? "evm-watch-ethereum"
          : "evm-watch-bsc",
        title: result.chain === "ethereum"
          ? "Ethereum 观察钱包"
          : "BNB Smart Chain 观察钱包",
        body: result.chain === "ethereum"
          ? "公开地址 ETH 与 ERC-20 只读来源"
          : "公开地址 BNB 与 BEP-20 只读来源",
      },
      sourceId,
    );
  }
}

export class InMemoryAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly secrets: InMemorySecretStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    const hasRefreshableSource = (await this.sources.list()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    if (!hasRefreshableSource) await this.fullRefreshState.clear();
  }

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

  async setDisplayName(
    sourceId: string,
    displayName: string,
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    const normalized = normalizeAssetSourceDisplayName(displayName);
    if (normalized === null) {
      const { displayName: _displayName, ...rest } = source;
      await this.sources.update(rest);
      return;
    }
    await this.sources.update({ ...source, displayName: normalized });
  }

  async setManualAssetClass(
    sourceId: string,
    assetClass: import("@/server/ports").ManualAssetClass | null,
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产来源可以设置资产类别");
    }
    if (assetClass === null) {
      const { manualAssetClass: _manualAssetClass, ...rest } = source;
      await this.sources.update(rest);
      return;
    }
    await this.sources.update({ ...source, manualAssetClass: assetClass });
  }

  async setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    const preferences = updateEvmTokenPreferences(
      source,
      assetKeys,
      status,
    );
    const {
      ignoredAssetKeys: _ignoredAssetKeys,
      includedAssetKeys: _includedAssetKeys,
      ...rest
    } = source;
    await this.sources.update({
      ...rest,
      ...(preferences.ignoredAssetKeys.length === 0
        ? {}
        : { ignoredAssetKeys: preferences.ignoredAssetKeys }),
      ...(preferences.includedAssetKeys.length === 0
        ? {}
        : { includedAssetKeys: preferences.includedAssetKeys }),
    });
  }

  async disconnect(sourceId: string): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
    await this.sources.update({ ...source, lifecycle: "disconnected" });
    await this.clearCycleWhenNoRefreshableSources();
  }

  async restore(sourceId: string): Promise<void> {
    const source = (await this.sources.list()).find((item) => item.id === sourceId);
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
    await this.sources.update({ ...source, lifecycle: "connected" });
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
    await this.clearCycleWhenNoRefreshableSources();
  }
}

export interface TestServices extends AppServices {
  clock: FakeClock;
  assetCards: InMemoryAssetCardStore;
  assetSources: FakeAssetSources;
  dailyAssetSnapshots: InMemoryDailyAssetSnapshots;
  formalDailySettlements: InMemoryFormalDailySettlements;
  formalDailySettlementRunner: FormalDailySettlementRunner;
  externalServices: InMemoryExternalServiceConfiguration;
  assetSynchronization: FakeAssetSynchronization;
  assetFullRefreshState: InMemoryAssetFullRefreshState;
  prices: FakePrices;
  auth: SessionOwnerAuth;
  ownerCredentials: InMemoryOwnerCredentialStore;
  ownerRecoveryCredentials: InMemoryOwnerRecoveryCredentialStore;
  secrets: InMemorySecretStore;
  longbridge: FakeLongbridgeOAuth;
  longbridgeBenchmarkCandlesticks: FakeLongbridgeBenchmarkCandlestickReader;
  longbridgeHoldingCandlesticks: FakeLongbridgeHoldingCandlestickReader;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance: FakeBinanceReadOnly;
  okx: FakeOkxReadOnly;
  bitget: FakeBitgetReadOnly;
  bit: FakeBitReadOnly;
  evm: FakeEvmWatchWallet;
  assetSourceConnections: InMemoryAssetSourceConnections;
  manualAssetRecords: InMemoryManualAssetRecords;
  investmentCashflows: InvestmentCashflowLedger;
  assetSourceOnboarding: AssetSourceOnboarding;
  assetSourceLifecycle: InMemoryAssetSourceLifecycle;
}

export function createTestServices(): TestServices {
  const clock = new FakeClock();
  const assetCards = new InMemoryAssetCardStore();
  const assetSources = new FakeAssetSources();
  const investmentCashflowStore = new InMemoryInvestmentCashflowStore();
  const investmentCashflows = new InvestmentCashflowLedger(
    investmentCashflowStore,
    assetSources,
    clock,
  );
  const dailyAssetSnapshots = new InMemoryDailyAssetSnapshots();
  const fullRefreshState = new InMemoryAssetFullRefreshState();
  const formalDailySettlements = new InMemoryFormalDailySettlements();
  const secrets = new InMemorySecretStore();
  const externalServices = new InMemoryExternalServiceConfiguration(clock);
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
      fullRefreshState,
    ),
    refreshAdapter,
  );
  const assetSourceLifecycle = new InMemoryAssetSourceLifecycle(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
    fullRefreshState,
  );
  const longbridge = new FakeLongbridgeOAuth();
  const longbridgeBenchmarkCandlesticks = new FakeLongbridgeBenchmarkCandlestickReader();
  const longbridgeHoldingCandlesticks = new FakeLongbridgeHoldingCandlestickReader();
  const binance = new FakeBinanceReadOnly(prices);
  const okx = new FakeOkxReadOnly();
  const bitget = new FakeBitgetReadOnly();
  const bit = new FakeBitReadOnly();
  const evm = new FakeEvmWatchWallet();
  const assetSourceConnections = new InMemoryAssetSourceConnections(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
    clock,
    fullRefreshState,
  );
  const manualAssetRecords = new InMemoryManualAssetRecords(
    assetSources,
    assetCards,
    dailyAssetSnapshots,
    clock,
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
  let exportedBackupFileName: string | null = null;
  const backupPreview = async () => {
    const [sources, cards, snapshots] = await Promise.all([
      assetSources.list(),
      assetCards.list(),
      dailyAssetSnapshots.list(),
    ]);
    const days = snapshots.map(({ day }) => day).sort();
    return {
      sourceCount: sources.length,
      cardCount: cards.length,
      snapshotRange: {
        from: days[0] ?? null,
        to: days.at(-1) ?? null,
      },
      replaces: {
        sourceCount: sources.length,
        cardCount: cards.length,
        snapshotCount: snapshots.length,
      },
      warning: "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
    };
  };
  return {
    clock,
    assetCards,
    assetSources,
    manualAssetRecords,
    investmentCashflows,
    assetSourceLifecycle,
    dailyAssetSnapshots,
    formalDailySettlements,
    formalDailySettlementRunner: new NotDueFormalDailySettlementRunner(),
    externalServices,
    assetSynchronization,
    assetFullRefreshState: fullRefreshState,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new InMemoryOwnerCredentialStore(),
    ownerRecoveryCredentials: new InMemoryOwnerRecoveryCredentialStore(),
    secrets,
    longbridge,
    longbridgeBenchmarkCandlesticks,
    longbridgeHoldingCandlesticks,
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
    bit,
    evm,
    assetSourceConnections,
    assetSourceOnboarding,
    businessDataBackups: {
      async exportBackup() {
        exportedBackupFileName = "asset-dashboard-test-backup.json";
        return {
          fileName: exportedBackupFileName,
          checksum: "test-only-checksum",
          warning: "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
        };
      },
      async previewRestore(fileName: string) {
        if (fileName !== exportedBackupFileName) {
          throw new Error("本机备份文件不存在");
        }
        return backupPreview();
      },
      async restore(fileName: string) {
        if (fileName !== exportedBackupFileName) {
          throw new Error("本机备份文件不存在");
        }
        return backupPreview();
      },
    },
  };
}
