import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { AssetSourceSummary } from "@/server/ports";
import type { TestServices } from "@/server/testing/fakes";

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
const { getTestServices, resetTestServices } = await import("@/server/composition");
const refresh = await import("@/app/test-doubles/refresh/route");
const daily = await import("@/app/test-doubles/daily-snapshots/route");
const health = await import("@/app/test-doubles/data-health/route");
hook.deregister();

async function withTestServices(run: (services: TestServices) => Promise<void>) {
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  resetTestServices();
  try {
    await run(getTestServices());
  } finally {
    process.env.APP_ENV = "test";
    resetTestServices();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  }
}

function request(body: unknown): Request {
  return new Request("http://localhost/test-doubles/fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assertValuedSource(source: AssetSourceSummary, amount: string, at: string) {
  assert.equal(source.accountId, source.id);
  assert.deepEqual(source.permissions, ["market-data", "account", "positions"]);
  assert.deepEqual(source.snapshot.total, { amount, currency: "USD" });
  assert.equal(source.snapshot.syncedAt, at);
  assert.equal(source.snapshot.holdings.length, 1);
  const holding = source.snapshot.holdings[0];
  assert.equal(holding.name, source.label);
  assert.equal(holding.quantity, "1");
  assert.equal(holding.currency, "USD");
  assert.deepEqual(holding.currentPrice, { amount, currency: "USD" });
  assert.equal(holding.marketValue, amount);
  assert.deepEqual(holding.sourceMarketValue, { amount, currency: "USD" });
  assert.equal(holding.valuation.status, "valued");
  assert.equal(holding.valuation.pricedAt, at);
  assert.equal(holding.costPrice, null);
  assert.equal(holding.changePercent, null);
  return holding.valuation;
}

test("刷新夹具保留初始估值时间、无汇率快照和可读取凭证", async () => {
  await withTestServices(async (services) => {
    assert.equal((await refresh.POST(request({ action: "configure", scenario: "partial-failure" }))).status, 200);
    assert.equal(services.clock.now().toISOString(), "2026-04-02T08:00:00.000Z");
    const sources = await services.assetSources.list();
    assert.deepEqual(sources.map((source) => [source.id, source.kind, source.label]), [
      ["source-alpha", "okx", "Alpha Securities"],
      ["source-beta", "okx", "Beta Crypto"],
    ]);
    for (const [index, source] of sources.entries()) {
      const valuation = assertValuedSource(source, index === 0 ? "100" : "200", "2026-04-01T08:00:00.000Z");
      assert.equal(source.snapshot.holdings[0].symbol, index === 0 ? "ALPHA" : "BETA");
      assert.equal(source.snapshot.holdings[0].assetClass, "securities");
      assert.equal(source.snapshot.holdings[0].platformProfit, null);
      assert.equal(valuation.priceSource, `${source.label} 初始行情`);
      assert.deepEqual(source.snapshot.exchangeRates, []);
      assert.deepEqual(source.sync, {
        status: "current", lastSuccessfulAt: "2026-04-01T08:00:00.000Z",
        lastAttemptAt: "2026-04-01T08:00:00.000Z", error: null,
      });
      assert.ok(source.credentialReference);
      assert.equal(await services.secrets.get(source.credentialReference), index === 0 ? "alpha-readonly-secret" : "beta-readonly-secret");
    }
    assert.deepEqual((await services.assetCards.list()).map((card) => [card.id, card.sourceId, card.span]), [
      ["refresh-card-1", "source-alpha", 1], ["refresh-card-2", "source-beta", 1],
    ]);
  });
});

test("刷新夹具保留单个 EVM 来源选择和刷新期间新增来源", async () => {
  await withTestServices(async (services) => {
    assert.equal((await refresh.POST(request({
      action: "configure", scenario: "schedule", sourceKind: "evm-watch-ethereum", sourceCount: 1,
    }))).status, 200);
    assert.equal((await refresh.POST(request({ action: "connect-during-refresh" }))).status, 200);
    const sources = await services.assetSources.list();
    assert.deepEqual(sources.map((source) => [source.id, source.kind]), [
      ["source-alpha", "evm-watch-ethereum"], ["source-gamma", "okx"],
    ]);
    assertValuedSource(sources[1], "50", "2026-04-01T08:00:00.000Z");
    assert.ok(sources[1].credentialReference);
    assert.equal(await services.secrets.get(sources[1].credentialReference), "gamma-readonly-secret");
    assert.deepEqual((await services.assetCards.list()).map((card) => [card.id, card.sourceId]), [
      ["refresh-card-1", "source-alpha"], ["refresh-card-3", "source-gamma"],
    ]);
  });
});

for (const [action, kinds] of [
  ["configure", ["okx", "okx"]],
  ["configure-longbridge", ["longbridge", "longbridge"]],
  ["configure-classified", ["longbridge", "binance"]],
] as const) {
  test(`每日快照夹具 ${action} 保留日界线、分类、平台盈亏与来源各自汇率`, async () => {
    await withTestServices(async (services) => {
      assert.equal((await daily.POST(request({ action }))).status, 200);
      assert.equal(services.clock.now().toISOString(), "2026-04-01T15:59:50.000Z");
      const sources = await services.assetSources.list();
      assert.deepEqual(sources.map((source) => source.kind), kinds);
      assert.deepEqual(sources.map((source) => source.id), ["source-alpha", "source-beta"]);
      for (const [index, source] of sources.entries()) {
        assertValuedSource(source, index === 0 ? "100" : "200", "2026-04-01T15:59:50.000Z");
        assert.equal(source.snapshot.holdings[0].assetClass, index === 0 ? "securities" : "crypto");
        assert.equal(source.snapshot.holdings[0].platformProfit, index === 0 ? "12.34" : null);
        assert.deepEqual(source.snapshot.exchangeRates, [{
          baseCurrency: "USD", quoteCurrency: "CNY", rate: index === 0 ? "7.2" : "7.1",
          source: "每日快照确定性汇率", observedAt: "2026-04-01T15:59:50.000Z",
        }, {
          baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8",
          source: "每日快照确定性港币汇率", observedAt: "2026-04-01T15:59:50.000Z",
        }]);
        assert.deepEqual(source.sync, {
          status: "current", lastSuccessfulAt: "2026-04-01T15:59:50.000Z",
          lastAttemptAt: "2026-04-01T15:59:50.000Z", error: null,
        });
        assert.ok(source.credentialReference);
        assert.equal(await services.secrets.get(source.credentialReference), index === 0 ? "alpha-readonly" : "beta-readonly");
      }
      assert.deepEqual((await services.assetCards.list()).map((card) => [card.id, card.sourceId]), [
        ["daily-card-0", "source-alpha"], ["daily-card-1", "source-beta"],
      ]);
      assert.deepEqual(await daily.GET().then((response) => response.json()), { days: [], baselines: [], trendObservations: [] });
    });
  });
}

test("数据健康夹具区分过期、未估值、手工记录与已断开汇率来源", async () => {
  await withTestServices(async (services) => {
    assert.equal((await health.POST(request({ action: "configure" }))).status, 200);
    const [alpha, beta, unvalued, manual, rates] = await services.assetSources.list();
    assert.equal(services.clock.now().toISOString(), "2026-03-04T12:00:00.000Z");
    assertValuedSource(alpha, "100", "2026-03-04T12:00:00.000Z");
    const betaValuation = assertValuedSource(beta, "200", "2026-03-03T12:00:00.000Z");
    assert.equal(beta.displayName, "Beta Crypto");
    assert.equal(beta.lifecycle, "connected");
    assert.equal(beta.credentialReference, "test-source-beta");
    assert.equal(betaValuation.priceSource, "Beta Crypto 确定性行情");
    assert.deepEqual(beta.sync, {
      status: "expired", lastSuccessfulAt: "2026-03-03T12:00:00.000Z",
      lastAttemptAt: "2026-03-04T12:00:00.000Z", error: "来源暂时不可用",
    });
    assert.deepEqual(unvalued.snapshot.holdings[0].valuation, { status: "unvalued", reason: "来源没有可靠价格" });
    assert.equal(unvalued.snapshot.holdings[0].currentPrice, null);
    assert.equal(manual.hasManualRecord, true);
    assert.deepEqual(manual.snapshot.total, { amount: "235396.50", currency: "CNY" });
    assertValuedSource(rates, "1", "2026-03-04T12:00:00.000Z");
    assert.equal(rates.kind, "longbridge");
    assert.equal(rates.lifecycle, "disconnected");
    assert.equal(rates.credentialReference, null);
    assert.deepEqual(rates.snapshot.exchangeRates, [{
      baseCurrency: "CNY", quoteCurrency: "USD", rate: "0.14817",
      source: "Longbridge 官方账户汇率", observedAt: "2026-03-04T12:00:00.000Z",
    }]);
    const observations = await services.dailyAssetSnapshots.listTrendObservations();
    assert.equal(observations.length, 4);
    assert.equal(observations[2].sources.some((source) => source.sourceId === "source-alpha"), false);
    assert.equal(observations[3].sources.find((source) => source.sourceId === "source-beta")?.status, "expired");
  });
});

test("夹具路由拒绝无效配置且不改动已有来源、卡片、时间与凭证", async () => {
  await withTestServices(async (services) => {
    await daily.POST(request({ action: "configure" }));
    const before = {
      sources: await services.assetSources.list(), cards: await services.assetCards.list(),
      at: services.clock.now().toISOString(), secrets: services.secrets.size(),
    };
    for (const [route, body] of [
      [refresh, { action: "configure", scenario: "invalid" }],
      [refresh, { action: "configure", scenario: "schedule", sourceCount: 3 }],
      [refresh, { action: "configure", scenario: "schedule", sourceKind: "manual" }],
      [daily, { action: "invalid" }], [health, null],
    ] as const) {
      assert.equal((await route.POST(request(body))).status, 400);
    }
    assert.deepEqual({
      sources: await services.assetSources.list(), cards: await services.assetCards.list(),
      at: services.clock.now().toISOString(), secrets: services.secrets.size(),
    }, before);
  });
});

test("非测试环境在读取请求与服务前拒绝所有夹具入口", async () => {
  await withTestServices(async (services) => {
    for (const env of [undefined, "production"]) {
      if (env === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = env;
      for (const route of [refresh, daily, health]) {
        const unavailableRequest = new Request("http://localhost/test-doubles/fixture", {
          method: "POST", body: "invalid json",
        });
        let reads = 0;
        unavailableRequest.json = async () => { reads += 1; throw new Error("请求不可读取"); };
        const response = await route.POST(unavailableRequest);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "not found" });
        assert.equal(reads, 0);
      }
      assert.equal((await refresh.GET()).status, 404);
      assert.equal((await daily.GET()).status, 404);
    }
    process.env.APP_ENV = "test";
    assert.equal(getTestServices(), services);
  });
});
