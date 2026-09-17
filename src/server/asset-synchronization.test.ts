import assert from "node:assert/strict";
import test from "node:test";

import { buildSnapshotFromPositions } from "@/domain/valuation";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import type {
  AssetFullRefreshState,
  AssetSourceRefresher,
  AssetSourceSummary,
  AssetSources,
  Clock,
  DailyAssetSnapshot,
  DailyAssetSnapshots,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  SecretStore,
} from "@/server/ports";

const INITIAL_AT = "2026-08-20T04:00:00.000Z";

class TestClock implements Clock {
  private value = new Date(INITIAL_AT);

  now(): Date { return this.value; }
  set(iso: string): void { this.value = new Date(iso); }
}

class TestSources implements AssetSources {
  constructor(private values: AssetSourceSummary[]) {}

  async list(): Promise<AssetSourceSummary[]> { return this.values; }
  async replaceAll(values: AssetSourceSummary[]): Promise<void> { this.values = values; }
  async update(source: AssetSourceSummary): Promise<void> {
    this.values = this.values.map((value) => value.id === source.id ? source : value);
  }
  setLifecycle(
    sourceId: AssetSourceSummary["id"],
    lifecycle: AssetSourceSummary["lifecycle"],
  ): void {
    this.values = this.values.map((source) =>
      source.id === sourceId ? { ...source, lifecycle } : source,
    );
  }
  remove(sourceId: AssetSourceSummary["id"]): void {
    this.values = this.values.filter((source) => source.id !== sourceId);
  }
  replaceCredential(
    sourceId: AssetSourceSummary["id"],
    credentialReference: string,
  ): void {
    this.values = this.values.map((source) =>
      source.id === sourceId ? { ...source, credentialReference } : source,
    );
  }
}

class TestSecrets implements SecretStore {
  constructor(private readonly values: Map<string, string>) {}

  async put(value: string): Promise<string> {
    const reference = `secret-${this.values.size + 1}`;
    this.values.set(reference, value);
    return reference;
  }
  async get(reference: string): Promise<string | null> { return this.values.get(reference) ?? null; }
  async replace(reference: string, value: string): Promise<void> { this.values.set(reference, value); }
  async remove(reference: string): Promise<void> { this.values.delete(reference); }
}

class TestFullRefreshState implements AssetFullRefreshState {
  private attemptedAt: string | null = null;
  private inProgressAt: string | null = null;

  async read() { return { attemptedAt: this.attemptedAt, inProgressAt: this.inProgressAt }; }
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

class TestDailySnapshots implements DailyAssetSnapshots {
  private baselines: DailyAssetSnapshot[] = [];
  private trends: DailyAssetTrendObservation[] = [];
  private recordFailure: Error | null = null;

  failNextRecord(): void {
    this.recordFailure = new Error("组合历史写入失败");
  }

  async list(): Promise<DailyAssetSnapshot[]> { return this.baselines; }
  async listTrendObservations(): Promise<DailyAssetTrendObservation[]> { return this.trends; }
  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return [];
  }
  async createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean> {
    if (this.baselines.some(({ day }) => day === snapshot.day)) return false;
    this.baselines.push(structuredClone(snapshot));
    this.trends.push(structuredClone(snapshot));
    return true;
  }
  async record(snapshot: DailyAssetTrendObservation, createBaseline: boolean): Promise<void> {
    if (this.recordFailure !== null) {
      const error = this.recordFailure;
      this.recordFailure = null;
      throw error;
    }
    if (createBaseline) await this.createIfAbsent(snapshot);
    const index = this.trends.findIndex(({ day }) => day === snapshot.day);
    if (index === -1) this.trends.push(structuredClone(snapshot));
    else this.trends[index] = structuredClone(snapshot);
  }
}

class TestRefresher implements AssetSourceRefresher {
  private scenario: "schedule" | "partial-failure" | "all-failure" = "schedule";
  private readonly calls = new Map<string, number>();

  configure(scenario: "schedule" | "partial-failure" | "all-failure"): void {
    this.scenario = scenario;
    this.calls.clear();
  }

  async refresh({ source, attemptedAt }: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    if (this.scenario === "all-failure") throw new Error("全部来源暂时不可用");
    if (this.scenario === "partial-failure" && source.id === "source-beta") {
      throw new Error("来源暂时不可用");
    }
    const count = (this.calls.get(source.id) ?? 0) + 1;
    this.calls.set(source.id, count);
    const amount = String((source.id === "source-alpha" ? 100 : 200) + count);
    return {
      snapshot: {
        ...source.snapshot,
        total: { amount, currency: "USD" },
        holdings: source.snapshot.holdings.map((holding, index) => index === 0 ? {
          ...holding,
          currentPrice: { amount, currency: "USD" },
          marketValue: amount,
          sourceMarketValue: { amount, currency: "USD" },
          valuation: { status: "valued" as const, priceSource: "测试行情", pricedAt: attemptedAt },
        } : holding),
        syncedAt: attemptedAt,
      },
    };
  }
}

class ControllableRefresher implements AssetSourceRefresher {
  readonly calls: string[] = [];
  private readonly holds = new Map<string, {
    markStarted: () => void;
    wait: Promise<void>;
    release: () => void;
  }>();

  hold(sourceId: string): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.holds.set(sourceId, { markStarted, wait, release });
    return { started, release };
  }

  async refresh({
    source,
    attemptedAt,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    this.calls.push(source.id);
    const hold = this.holds.get(source.id);
    if (hold !== undefined) {
      this.holds.delete(source.id);
      hold.markStarted();
      await hold.wait;
    }
    return { snapshot: { ...source.snapshot, syncedAt: attemptedAt } };
  }
}

function source(input: {
  id: "source-alpha" | "source-beta";
  amount: string;
  credentialReference: string;
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.id === "source-alpha" ? "longbridge" : "binance",
    label: input.id,
    accountId: input.id,
    permissions: ["account", "positions", "market-data"],
    credentialReference: input.credentialReference,
    lifecycle: "connected",
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: input.id,
        name: input.id,
        quantity: "1",
        currency: "USD",
        assetClass: input.id === "source-alpha" ? "securities" : "crypto",
        currentPrice: { amount: input.amount, currency: "USD" },
        priceSource: "测试行情",
        pricedAt: INITIAL_AT,
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        source: "测试汇率",
        observedAt: INITIAL_AT,
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "测试汇率",
        observedAt: INITIAL_AT,
      }],
      syncedAt: INITIAL_AT,
    }),
    sync: {
      status: "current",
      lastSuccessfulAt: INITIAL_AT,
      lastAttemptAt: INITIAL_AT,
      error: null,
    },
  };
}

async function synchronizationFixture(input: {
  refresher?: AssetSourceRefresher;
  sourceTimeoutMs?: number;
} = {}) {
  const clock = new TestClock();
  const sources = new TestSources([
    source({
      id: "source-alpha",
      amount: "100",
      credentialReference: "alpha-reference",
    }),
    source({
      id: "source-beta",
      amount: "200",
      credentialReference: "beta-reference",
    }),
  ]);
  const secrets = new TestSecrets(new Map([
    ["alpha-reference", "alpha"],
    ["beta-reference", "beta"],
  ]));
  const refresher = input.refresher ?? new TestRefresher();
  const dailySnapshots = new TestDailySnapshots();
  const fullRefreshState = new TestFullRefreshState();
  return {
    clock,
    sources,
    refresher: refresher as TestRefresher,
    dailySnapshots,
    fullRefreshState,
    synchronization: new SourceIsolatedAssetSynchronization(
      sources,
      secrets,
      clock,
      refresher,
      input.sourceTimeoutMs ?? 100,
      dailySnapshots,
      fullRefreshState,
    ),
  };
}

test("完整全量批次冻结当天首个基准并更新趋势", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");

  await fixture.synchronization.refresh("all");
  const firstState = await fixture.fullRefreshState.read();
  assert.deepEqual(firstState, {
    attemptedAt: "2026-08-20T04:00:00.000Z",
    inProgressAt: null,
  });
  assert.equal((await fixture.dailySnapshots.list())[0]?.total.USD, "302");
  assert.equal((await fixture.dailySnapshots.listTrendObservations())[0]?.total.USD, "302");

  fixture.clock.set("2026-08-20T05:00:00.000Z");
  await fixture.synchronization.refresh("all");
  assert.equal((await fixture.dailySnapshots.list())[0]?.total.USD, "302");
  assert.equal((await fixture.dailySnapshots.listTrendObservations())[0]?.total.USD, "304");
});

test("部分成功写入当天趋势兜底，后续全失败不会覆盖", async () => {
  const fixture = await synchronizationFixture();
  const betaBeforeFailure = structuredClone(
    (await fixture.sources.list()).find(({ id }) => id === "source-beta")!,
  );

  fixture.refresher.configure("partial-failure");
  const partial = await fixture.synchronization.refresh("all");
  assert.deepEqual(partial, {
    successCount: 1,
    failureCount: 1,
    attemptedAt: "2026-08-20T04:00:00.000Z",
  });
  const betaAfterPartial = (await fixture.sources.list()).find(
    ({ id }) => id === "source-beta",
  )!;
  assert.deepEqual(betaAfterPartial.snapshot, betaBeforeFailure.snapshot);
  assert.equal(betaAfterPartial.sync.lastSuccessfulAt, betaBeforeFailure.sync.lastSuccessfulAt);
  assert.equal(betaAfterPartial.sync.status, "expired");
  assert.equal(betaAfterPartial.sync.lastAttemptAt, "2026-08-20T04:00:00.000Z");
  assert.deepEqual(await fixture.dailySnapshots.list(), []);
  const historyBeforeFailure = await fixture.dailySnapshots.listTrendObservations();
  assert.equal(historyBeforeFailure.length, 1);
  assert.deepEqual(historyBeforeFailure[0]?.total, {
    USD: "301",
    CNY: "2167.2",
    HKD: "2347.8",
  });
  assert.deepEqual(historyBeforeFailure[0] && {
    day: historyBeforeFailure[0].day,
    capturedAt: historyBeforeFailure[0].capturedAt,
    complete: historyBeforeFailure[0].complete,
    status: historyBeforeFailure[0].status,
  }, {
    day: "2026-08-20",
    capturedAt: "2026-08-20T04:00:00.000Z",
    complete: true,
    status: "expired",
  });

  fixture.clock.set("2026-08-20T05:00:00.000Z");
  fixture.refresher.configure("all-failure");
  await fixture.synchronization.refresh("all");
  assert.deepEqual(
    await fixture.dailySnapshots.listTrendObservations(),
    historyBeforeFailure,
  );
  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T05:00:00.000Z",
    inProgressAt: null,
  });
});

test("全量批次在历史收尾异常后保留中断诊断", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");
  fixture.dailySnapshots.failNextRecord();

  await assert.rejects(
    fixture.synchronization.refresh("all"),
    /组合历史写入失败/,
  );

  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T04:00:00.000Z",
    inProgressAt: "2026-08-20T04:00:00.000Z",
  });

  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "manual-global" },
    }),
    {
      successCount: 0,
      failureCount: 0,
      skipped: "in-progress",
      attemptedAt: INITIAL_AT,
    },
  );

  fixture.clock.set("2026-08-20T04:01:00.000Z");
  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "manual-global" },
    }),
    {
      successCount: 2,
      failureCount: 0,
      attemptedAt: "2026-08-20T04:01:00.000Z",
    },
  );
  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T04:01:00.000Z",
    inProgressAt: null,
  });
});

test("单来源刷新不改变全量周期或组合历史，手动全量可绕过未到期周期", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");

  await fixture.synchronization.request({
    intent: { reason: "page-entry" },
  });
  const historyBeforeSingleSource = structuredClone(
    await fixture.dailySnapshots.listTrendObservations(),
  );
  fixture.clock.set("2026-08-20T04:10:00.000Z");
  await fixture.synchronization.refresh("all", "all", "source-alpha");

  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T04:00:00.000Z",
    inProgressAt: null,
  });
  assert.deepEqual(
    await fixture.dailySnapshots.listTrendObservations(),
    historyBeforeSingleSource,
  );
  assert.equal(
    (await fixture.sources.list()).find(({ id }) => id === "source-alpha")?.snapshot.total.amount,
    "102",
  );

  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "manual-global" },
    }),
    {
      successCount: 2,
      failureCount: 0,
      attemptedAt: "2026-08-20T04:10:00.000Z",
    },
  );
  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T04:10:00.000Z",
    inProgressAt: null,
  });
});

test("断开来源不参与新历史，恢复后须等待下一完整批次", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");

  await fixture.synchronization.refresh("all");
  fixture.sources.setLifecycle("source-beta", "disconnected");

  fixture.clock.set("2026-08-20T05:00:00.000Z");
  await fixture.synchronization.refresh("all");
  assert.deepEqual(
    (await fixture.dailySnapshots.listTrendObservations())[0]?.sources.map(
      ({ sourceId }) => sourceId,
    ),
    ["source-alpha"],
  );

  fixture.sources.setLifecycle("source-beta", "connected");
  fixture.clock.set("2026-08-20T06:00:00.000Z");
  await fixture.synchronization.refresh("all", "all", "source-beta");
  assert.deepEqual(
    (await fixture.dailySnapshots.listTrendObservations())[0]?.sources.map(
      ({ sourceId }) => sourceId,
    ),
    ["source-alpha"],
  );

  fixture.clock.set("2026-08-20T07:00:00.000Z");
  await fixture.synchronization.refresh("all");
  assert.deepEqual(
    (await fixture.dailySnapshots.listTrendObservations())[0]?.sources.map(
      ({ sourceId }) => sourceId,
    ),
    ["source-alpha", "source-beta"],
  );
});

test("旧来源没有统一周期时仍视为到期，首次失败全量建立锚点", async () => {
  const fixture = await synchronizationFixture();
  fixture.clock.set("2026-08-20T08:00:00.000Z");
  fixture.refresher.configure("all-failure");

  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: null,
    inProgressAt: null,
  });
  await fixture.synchronization.refresh("all");

  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T08:00:00.000Z",
    inProgressAt: null,
  });
  assert.deepEqual(await fixture.dailySnapshots.list(), []);
  assert.deepEqual(await fixture.dailySnapshots.listTrendObservations(), []);
});

test("自动全量只在统一周期到期后执行，并复用同一批次", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");

  const first = fixture.synchronization.request({
    intent: { reason: "page-entry" },
  });
  const duplicate = fixture.synchronization.request({
    intent: { reason: "foreground" },
  });
  assert.equal(first, duplicate);
  assert.deepEqual(await first, {
    successCount: 2,
    failureCount: 0,
    attemptedAt: "2026-08-20T04:00:00.000Z",
  });

  fixture.clock.set("2026-08-20T04:59:59.999Z");
  const notDue = await fixture.synchronization.request({
    intent: { reason: "interval" },
  });
  assert.deepEqual(notDue, {
    successCount: 0,
    failureCount: 0,
    skipped: "not-due",
    attemptedAt: INITIAL_AT,
  });

  fixture.clock.set("2026-08-20T05:00:00.000Z");
  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "interval" },
    }),
    {
      successCount: 2,
      failureCount: 0,
      attemptedAt: "2026-08-20T05:00:00.000Z",
    },
  );
});

test("两个协调器共享持久化预占时只允许一份自动全量读取", async () => {
  const refresher = new ControllableRefresher();
  const alpha = refresher.hold("source-alpha");
  const fixture = await synchronizationFixture({ refresher });
  const anotherCoordinator = new SourceIsolatedAssetSynchronization(
    fixture.sources,
    new TestSecrets(new Map([
      ["alpha-reference", "alpha"],
      ["beta-reference", "beta"],
    ])),
    fixture.clock,
    refresher,
    100,
    fixture.dailySnapshots,
    fixture.fullRefreshState,
  );

  const first = fixture.synchronization.request({
    intent: { reason: "page-entry" },
  });
  await alpha.started;
  const duplicate = await anotherCoordinator.request({
    intent: { reason: "foreground" },
  });
  assert.deepEqual(duplicate, {
    successCount: 0,
    failureCount: 0,
    skipped: "in-progress",
    attemptedAt: INITIAL_AT,
  });
  assert.deepEqual(refresher.calls.toSorted(), ["source-alpha", "source-beta"]);

  alpha.release();
  assert.deepEqual(await first, {
    successCount: 2,
    failureCount: 0,
    attemptedAt: "2026-08-20T04:00:00.000Z",
  });
});

test("手动全量可绕过周期但不能绕过其他协调器的在途批次", async () => {
  const refresher = new ControllableRefresher();
  const alpha = refresher.hold("source-alpha");
  const fixture = await synchronizationFixture({ refresher });
  const anotherCoordinator = new SourceIsolatedAssetSynchronization(
    fixture.sources,
    new TestSecrets(new Map([
      ["alpha-reference", "alpha"],
      ["beta-reference", "beta"],
    ])),
    fixture.clock,
    refresher,
    100,
    fixture.dailySnapshots,
    fixture.fullRefreshState,
  );

  const first = fixture.synchronization.request({
    intent: { reason: "manual-global" },
  });
  await alpha.started;

  assert.deepEqual(
    await anotherCoordinator.request({
      intent: { reason: "manual-global" },
    }),
    {
      successCount: 0,
      failureCount: 0,
      skipped: "in-progress",
      attemptedAt: INITIAL_AT,
    },
  );
  assert.deepEqual(refresher.calls.toSorted(), ["source-alpha", "source-beta"]);

  alpha.release();
  assert.deepEqual(await first, {
    successCount: 2,
    failureCount: 0,
    attemptedAt: "2026-08-20T04:00:00.000Z",
  });
});

test("部分失败、全部失败与超时仍等待下一统一周期", async () => {
  for (const scenario of ["partial-failure", "all-failure"] as const) {
    const fixture = await synchronizationFixture();
    fixture.refresher.configure(scenario);
    await fixture.synchronization.request({
      intent: { reason: "page-entry" },
    });
    assert.deepEqual(
      await fixture.synchronization.request({
        intent: { reason: "foreground" },
      }),
      {
        successCount: 0,
        failureCount: 0,
        skipped: "not-due",
        attemptedAt: INITIAL_AT,
      },
    );
  }

  const hung: AssetSourceRefresher = {
    async refresh() { return await new Promise<never>(() => undefined); },
  };
  const fixture = await synchronizationFixture({
    refresher: hung,
    sourceTimeoutMs: 10,
  });
  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "page-entry" },
    }),
    {
      successCount: 0,
      failureCount: 2,
      attemptedAt: "2026-08-20T04:00:00.000Z",
    },
  );
  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "interval" },
    }),
    {
      successCount: 0,
      failureCount: 0,
      skipped: "not-due",
      attemptedAt: INITIAL_AT,
    },
  );
});

test("遗留进行中标记在下一到期批次不形成永久锁", async () => {
  const fixture = await synchronizationFixture();
  fixture.refresher.configure("schedule");
  await fixture.fullRefreshState.start(INITIAL_AT);
  fixture.clock.set("2026-08-20T05:00:00.000Z");

  assert.deepEqual(
    await fixture.synchronization.request({
      intent: { reason: "interval" },
    }),
    {
      successCount: 2,
      failureCount: 0,
      attemptedAt: "2026-08-20T05:00:00.000Z",
    },
  );
  assert.deepEqual(await fixture.fullRefreshState.read(), {
    attemptedAt: "2026-08-20T05:00:00.000Z",
    inProgressAt: null,
  });
});

test("已开始单来源后，全量吸收排队目标并在后续完整批次读取全部来源", async () => {
  const refresher = new ControllableRefresher();
  const alpha = refresher.hold("source-alpha");
  const fixture = await synchronizationFixture({ refresher });

  const single = fixture.synchronization.request({
    intent: { reason: "manual-source", sourceId: "source-alpha" },
  });
  await alpha.started;
  const pendingBeta = fixture.synchronization.request({
    intent: { reason: "manual-source", sourceId: "source-beta" },
  });
  fixture.clock.set("2026-08-20T04:30:00.000Z");
  const full = fixture.synchronization.request({
    intent: { reason: "manual-global" },
  });
  const duplicate = fixture.synchronization.request({
    intent: { reason: "foreground" },
  });
  assert.equal(pendingBeta, full);
  assert.equal(duplicate, full);

  alpha.release();
  assert.deepEqual(await single, { successCount: 1, failureCount: 0 });
  assert.deepEqual(await full, {
    successCount: 2,
    failureCount: 0,
    attemptedAt: "2026-08-20T04:30:00.000Z",
  });
  assert.equal(
    refresher.calls.filter((sourceId) => sourceId === "source-alpha").length,
    2,
  );
  assert.equal(
    refresher.calls.filter((sourceId) => sourceId === "source-beta").length,
    1,
  );
  assert.equal((await fixture.dailySnapshots.listTrendObservations()).length, 1);
});

test("来源生命周期变化使在途读取安全结束，不污染同步错误或组合历史", async () => {
  for (const change of [
    (sources: TestSources) => sources.setLifecycle("source-alpha", "disconnected"),
    (sources: TestSources) => sources.replaceCredential("source-alpha", "replacement-reference"),
    (sources: TestSources) => sources.remove("source-alpha"),
  ]) {
    const refresher = new ControllableRefresher();
    const alpha = refresher.hold("source-alpha");
    const fixture = await synchronizationFixture({ refresher });
    const before = structuredClone(
      (await fixture.sources.list()).find(({ id }) => id === "source-alpha")!,
    );

    const full = fixture.synchronization.request({
      intent: { reason: "manual-global" },
    });
    await alpha.started;
    change(fixture.sources);
    alpha.release();

    assert.deepEqual(await full, {
      successCount: 1,
      failureCount: 0,
      supersededCount: 1,
      attemptedAt: "2026-08-20T04:00:00.000Z",
    });
    const current = (await fixture.sources.list()).find(
      ({ id }) => id === "source-alpha",
    );
    if (current !== undefined) {
      assert.equal(current.sync.error, null);
      assert.deepEqual(current.snapshot, before.snapshot);
    }
    assert.deepEqual(await fixture.dailySnapshots.listTrendObservations(), []);
  }
});
