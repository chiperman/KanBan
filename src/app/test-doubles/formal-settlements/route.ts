import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSnapshotFromPositions } from "@/domain/valuation";
import {
  MarketCloseFormalDailySettlement,
  ReadOnlyFormalSettlementSourceCapture,
} from "@/server/formal-daily-settlement";
import {
  DatabaseFormalDailySettlements,
  SqliteDashboardDatabase,
} from "@/server/production";
import { getTestServices, isTestEnv } from "@/server/composition";
import type {
  AssetSourceRefresher,
  AssetSourceSummary,
  FormalSettlementCandleReader,
  FormalSettlementSourceCapture,
  SecretStore,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const CAPTURED_AT = "2026-08-05T20:05:00.000Z";
const PUBLIC_EVM_CAPTURED_AT = "2026-08-04T16:10:00.000Z";

function exchangeRates(observedAt: string) {
  return [{
    baseCurrency: "USD",
    quoteCurrency: "CNY",
    rate: "7.2",
    source: "正式日结测试汇率",
    observedAt,
  }, {
    baseCurrency: "USD",
    quoteCurrency: "HKD",
    rate: "7.8",
    source: "正式日结测试汇率",
    observedAt,
  }];
}

function sourceFixture(): AssetSourceSummary[] {
  const securitySnapshot = buildSnapshotFromPositions({
    positions: [{
      symbol: "NVDA.US",
      name: "NVIDIA",
      quantity: "1",
      currency: "USD",
      assetClass: "securities",
      currentPrice: { amount: "217.250", currency: "USD" },
      priceSource: "Longbridge 盘后实时行情",
      pricedAt: "2026-08-05T20:04:00.000Z",
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }],
    sourceCurrency: "USD",
    exchangeRates: exchangeRates(CAPTURED_AT),
    syncedAt: "2026-08-05T20:04:00.000Z",
  });
  securitySnapshot.holdings[0].quoteEvidence = {
    session: "post-market",
    quotedAt: "2026-08-05T20:04:00.000Z",
    observedAt: "2026-08-05T20:04:00.000Z",
    freshness: "current",
    delivery: "unknown",
    provider: {
      name: "longbridge",
      tradeStatus: "US_AFTER",
    },
  };
  const cryptoSnapshot = buildSnapshotFromPositions({
    positions: [{
      symbol: "BTC",
      name: "Bitcoin",
      quantity: "0.002",
      currency: "USD",
      assetClass: "crypto",
      currentPrice: { amount: "51000", currency: "USD" },
      priceSource: "加密市场采集价",
      pricedAt: CAPTURED_AT,
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }],
    sourceCurrency: "USD",
    exchangeRates: exchangeRates(CAPTURED_AT),
    syncedAt: CAPTURED_AT,
  });
  return [{
    id: "longbridge-source",
    kind: "longbridge",
    label: "长桥证券",
    accountId: "longbridge:test",
    permissions: ["account", "positions", "market-data"],
    credentialReference: "macos-keychain:test",
    snapshot: securitySnapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: securitySnapshot.syncedAt,
      lastAttemptAt: securitySnapshot.syncedAt,
      error: null,
    },
  }, {
    id: "crypto-source",
    kind: "okx",
    label: "加密资产",
    accountId: "crypto:test",
    permissions: ["account", "positions", "market-data"],
    credentialReference: "crypto:test",
    snapshot: cryptoSnapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: cryptoSnapshot.syncedAt,
      lastAttemptAt: cryptoSnapshot.syncedAt,
      error: null,
    },
  }];
}

function manualSourceFixture(): AssetSourceSummary {
  const snapshot = buildSnapshotFromPositions({
    positions: [{
      symbol: "MANUAL-CNY",
      name: "A股",
      quantity: "100000",
      currency: "CNY",
      assetClass: "cash",
      currentPrice: { amount: "1", currency: "CNY" },
      priceSource: "手工记录",
      pricedAt: "2026-08-05T12:00:00.000Z",
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }],
    sourceCurrency: "CNY",
    exchangeRates: [],
    syncedAt: "2026-08-05T12:00:00.000Z",
  });
  return {
    id: "manual-source",
    kind: "manual",
    label: "A股",
    accountId: "manual:A股",
    permissions: [],
    credentialReference: null,
    snapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: snapshot.syncedAt,
      lastAttemptAt: snapshot.syncedAt,
      error: null,
    },
    hasManualRecord: true,
  };
}

function publicEvmSourceFixture(): AssetSourceSummary {
  const snapshot = buildSnapshotFromPositions({
    positions: [{
      symbol: "ETH",
      name: "Ethereum",
      quantity: "1",
      currency: "USD",
      assetClass: "crypto",
      currentPrice: { amount: "3600", currency: "USD" },
      priceSource: "公开行情",
      pricedAt: PUBLIC_EVM_CAPTURED_AT,
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }],
    sourceCurrency: "USD",
    exchangeRates: exchangeRates(PUBLIC_EVM_CAPTURED_AT),
    syncedAt: PUBLIC_EVM_CAPTURED_AT,
  });
  return {
    id: "public-evm-source",
    kind: "evm-watch-ethereum",
    label: "Ethereum 观察钱包",
    accountId: "0x0000000000000000000000000000000000000000",
    permissions: ["public-address", "market-data"],
    credentialReference: null,
    snapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: snapshot.syncedAt,
      lastAttemptAt: snapshot.syncedAt,
      error: null,
    },
  };
}

const sourceCapture: FormalSettlementSourceCapture = {
  async capture({ source, attemptedAt }) {
    return {
      ...structuredClone(source.snapshot),
      exchangeRates: source.snapshot.exchangeRates.map((rate) => ({
        ...rate,
        observedAt: attemptedAt,
      })),
      syncedAt: attemptedAt,
    };
  },
};

const publicOnlySecretStore: SecretStore = {
  async put() {
    throw new Error("公开来源不应写入凭证");
  },
  async get() {
    throw new Error("公开来源不应读取凭证");
  },
  async replace() {
    throw new Error("公开来源不应更新凭证");
  },
  async remove() {
    throw new Error("公开来源不应删除凭证");
  },
};

const publicEvmRefresher: AssetSourceRefresher = {
  async refresh({ source, credentials, attemptedAt }) {
    if (credentials !== "") throw new Error("公开来源不应要求凭证");
    return {
      snapshot: {
        ...structuredClone(source.snapshot),
        syncedAt: attemptedAt,
      },
    };
  },
};

const candleReader: FormalSettlementCandleReader = {
  async readDailyCandles({ symbols }) {
    return symbols.flatMap((symbol) =>
      symbol === "NVDA.US"
        ? [{
            symbol,
            close: "211.940",
            timestamp: "2026-08-05T20:00:00.000Z",
            tradeSession: "intraday" as const,
          }]
        : [],
    );
  },
};

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: unknown; quality?: unknown; scenario?: unknown } | null;
  if (body?.action === "seed-runtime-view") {
    const services = getTestServices();
    const scenario = body.scenario;
    if (!["not-loaded", "unknown", "error", "waiting"].includes(String(scenario))) return Response.json({ error: "invalid scenario" }, { status: 400 });
    services.formalSettlementScheduler.state = scenario === "not-loaded" ? "not-loaded" : "query-failed";
    if (scenario === "error" || scenario === "waiting") {
      await services.formalSettlementExecutions.record({
        startedAt: "2026-09-18T00:00:00.000Z", finishedAt: "2026-09-18T00:01:00.000Z",
        outcome: scenario, reason: scenario === "error" ? "candle-read-failed" : "official-close-pending", settlementStatus: null,
      });
    }
    return Response.json({ ok: true });
  }
  if (body?.action === "seed-owner-view") {
    const quality = body.quality ?? "complete";
    if (quality !== "complete" && quality !== "incomplete" && quality !== "missed") return Response.json({ error: "invalid quality" }, { status: 400 });
    await getTestServices().formalDailySettlements.recordIfAbsent({
      anchor: {
        key: `securities-close:US:2026-08-05:${quality}`,
        kind: "securities-close",
        market: "US",
        tradingDay: "2026-08-05",
        scheduledCloseAt: "2026-08-05T20:00:00.000Z",
      },
      capturedAt: quality === "missed" ? null : CAPTURED_AT,
      status: quality,
      diagnostic: null,
      total: quality === "missed" ? { USD: null, CNY: null, HKD: null } : { USD: "313.94", CNY: "2260.368", HKD: "2448.732" },
      exchangeRates: exchangeRates(CAPTURED_AT),
      sources: [],
      holdings: [{
        sourceId: "source-alpha",
        sourceAsset: null,
        symbol: "NVDA.US",
        name: "NVIDIA",
        quantity: "1",
        assetClass: "securities",
        price: { amount: "211.940", currency: "USD" },
        priceBasis: "official-close",
        priceObservedAt: "2026-08-05T20:00:00.000Z",
        market: "US",
        marketTradingDay: "2026-08-05",
        marketValue: "211.94",
        diagnostic: null,
      }, {
        sourceId: "source-beta",
        sourceAsset: null,
        symbol: "BTC",
        name: "Bitcoin",
        quantity: "0.002",
        assetClass: "crypto",
        price: { amount: "51000", currency: "USD" },
        priceBasis: "capture-time",
        priceObservedAt: CAPTURED_AT,
        market: null,
        marketTradingDay: null,
        marketValue: "102",
        diagnostic: null,
      }],
    });
    return Response.json({ ok: true });
  }
  if (
    body?.action !== "run-production-shaped" &&
    body?.action !== "run-with-manual-source" &&
    body?.action !== "run-with-public-evm-source" &&
    body?.action !== "run-with-public-evm-source-with-reference" &&
    body?.action !== "run-without-cny-rate" &&
    body?.action !== "run-without-hkd-rate"
  ) {
    return Response.json({ error: "正式日结测试配置无效" }, { status: 400 });
  }
  const root = await mkdtemp(path.join(tmpdir(), "pad-formal-settlement-"));
  try {
    const database = new SqliteDashboardDatabase(path.join(root, "dashboard.sqlite"));
    const isPublicScenario = body.action.startsWith("run-with-public-evm-source");
    const sources = [
      ...(isPublicScenario
        ? [publicEvmSourceFixture()]
        : sourceFixture()),
      ...(body.action === "run-with-manual-source" ? [manualSourceFixture()] : []),
    ];
    if (body.action === "run-with-public-evm-source-with-reference") {
      const reference = sourceFixture()[0];
      reference.snapshot = buildSnapshotFromPositions({
        positions: [],
        sourceCurrency: "USD",
        exchangeRates: exchangeRates(PUBLIC_EVM_CAPTURED_AT),
        syncedAt: PUBLIC_EVM_CAPTURED_AT,
      });
      sources.unshift(reference);
    }
    const missingCurrency = body.action === "run-without-cny-rate"
      ? "CNY"
      : body.action === "run-without-hkd-rate" ? "HKD" : null;
    if (missingCurrency !== null) {
      for (const source of sources) {
        source.snapshot.exchangeRates = source.snapshot.exchangeRates.filter(
          (rate) => rate.quoteCurrency !== missingCurrency,
        );
      }
    }
    await database.replaceSources(sources);
    const settlements = new DatabaseFormalDailySettlements(database);
    const runner = new MarketCloseFormalDailySettlement(
      {
        list: () => database.listSources(),
        replaceAll: (values) => database.replaceSources(values),
        update: (source) => database.updateSource(source),
      },
      {
        now: () =>
          new Date(
            isPublicScenario
              ? PUBLIC_EVM_CAPTURED_AT
              : CAPTURED_AT,
          ),
      },
      settlements,
      isPublicScenario
        ? {
            capture: (input) => input.source.kind === "longbridge"
              ? sourceCapture.capture(input)
              : new ReadOnlyFormalSettlementSourceCapture(
                  publicOnlySecretStore,
                  publicEvmRefresher,
                ).capture(input),
          }
        : sourceCapture,
      candleReader,
      undefined,
      { async readTradingDays() {
        return { tradingDays: ["2026-08-04", "2026-08-05"], halfTradingDays: [] };
      } },
    );
    const firstRun = await runner.run();
    if (
      body.action === "run-with-manual-source" ||
      isPublicScenario || missingCurrency !== null
    ) {
      return Response.json({
        outcome: firstRun.outcome,
        settlement: (await settlements.list())[0],
      });
    }
    const secondRun = await runner.run();
    const recordedSettlements = await settlements.list();
    const currentSecurity = (await database.listSources())
      .find((source) => source.id === "longbridge-source")
      ?.snapshot.holdings[0];
    await database.deleteAssetSourceData("longbridge-source");
    return Response.json({
      currentSecurityPrice: currentSecurity?.currentPrice?.amount,
      currentSecuritySession: currentSecurity?.quoteEvidence?.session,
      firstRun,
      secondRun,
      dailyTrendCount: (await database.listDailyAssetTrendObservations()).length,
      settlements: recordedSettlements,
      settlementCountAfterSourceDeletion: (await settlements.list()).length,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
