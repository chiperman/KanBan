import { buildSnapshotFromPositions, type RawAssetPosition } from "@/domain/valuation";
import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetExchangeRate, AssetSourceSummary, Card } from "@/server/ports";

export const dynamic = "force-dynamic";

const SYNCED_AT = "2026-04-01T08:00:00.000Z";

const CURRENT_SYNC = {
  status: "current" as const,
  lastSuccessfulAt: SYNCED_AT,
  lastAttemptAt: SYNCED_AT,
  error: null,
};

function exchangeRates(inverse: boolean): AssetExchangeRate[] {
  return [{
    baseCurrency: inverse ? "CNY" : "USD",
    quoteCurrency: inverse ? "USD" : "CNY",
    rate: inverse ? "0.14" : "7.1234",
    source: "Longbridge 账户汇率",
    observedAt: SYNCED_AT,
  }, {
    baseCurrency: "HKD",
    quoteCurrency: "USD",
    rate: "0.128",
    source: "Alpha 账户汇率",
    observedAt: SYNCED_AT,
  }];
}

function alphaPositions(): RawAssetPosition[] {
  return [{
    symbol: "AAPL.US",
    name: "Apple",
    quantity: "1",
    currency: "USD",
    assetClass: "securities",
    currentPrice: { amount: "200.01", currency: "USD" },
    priceSource: "Alpha 原生行情",
    pricedAt: SYNCED_AT,
    costPrice: "180",
    platformProfit: "20.01",
    changePercent: "1.01",
  }, {
    symbol: "0700.HK",
    name: "Tencent",
    quantity: "10",
    currency: "HKD",
    assetClass: "securities",
    currentPrice: { amount: "50", currency: "HKD" },
    priceSource: "Alpha 原生行情",
    pricedAt: SYNCED_AT,
    costPrice: "48",
    platformProfit: "20",
    changePercent: "0.5",
  }, {
    symbol: "TINY.US",
    name: "Tiny Position",
    quantity: "0.00000001",
    currency: "USD",
    assetClass: "securities",
    currentPrice: { amount: "0.00000001", currency: "USD" },
    priceSource: "Alpha 原生行情",
    pricedAt: SYNCED_AT,
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  }];
}

function betaPositions(): RawAssetPosition[] {
  return [{
    symbol: "AAPL.US",
    name: "Apple Cross-source",
    quantity: "1",
    currency: "USD",
    assetClass: "securities",
    currentPrice: { amount: "200.03", currency: "USD" },
    priceSource: "Beta 原生行情",
    pricedAt: SYNCED_AT,
    costPrice: null,
    platformProfit: null,
    changePercent: "1.02",
  }, {
    symbol: "USDT",
    name: "Tether",
    quantity: "100",
    currency: "USD",
    assetClass: "crypto",
    currentPrice: { amount: "0.973", currency: "USD" },
    priceSource: "Beta USDT/USD 实际行情",
    pricedAt: SYNCED_AT,
    costPrice: null,
    platformProfit: null,
    changePercent: "-2.7",
  }, {
    symbol: "MYST",
    name: "Mystery Token",
    quantity: "2.5",
    currency: "USD",
    assetClass: "crypto",
    currentPrice: null,
    unvaluedReason: "来源没有可靠价格",
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  }];
}

function standardSources(input: {
  inverse: boolean;
  alphaAdjustment?: string;
}): AssetSourceSummary[] {
  const rates = exchangeRates(input.inverse);
  return [{
    id: "source-alpha",
    kind: "valuation-fixture",
    label: "Alpha Securities",
    accountId: "alpha",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-alpha",
    snapshot: buildSnapshotFromPositions({
      positions: alphaPositions(),
      sourceCurrency: "USD",
      exchangeRates: rates,
      syncedAt: SYNCED_AT,
      adjustment: input.alphaAdjustment,
    }),
    sync: CURRENT_SYNC,
  }, {
    id: "source-beta",
    kind: "valuation-fixture",
    label: "Beta Crypto",
    accountId: "beta",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-beta",
    snapshot: buildSnapshotFromPositions({
      positions: betaPositions(),
      sourceCurrency: "USD",
      exchangeRates: rates,
      syncedAt: SYNCED_AT,
    }),
    sync: CURRENT_SYNC,
  }];
}

function roundingSources(): AssetSourceSummary[] {
  return [{
    id: "source-rounding",
    kind: "valuation-fixture",
    label: "Rounding Source",
    accountId: "rounding",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-rounding",
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: "HALF.SEC",
        name: "Half Cent Security",
        quantity: "1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: "0.005", currency: "USD" },
        priceSource: "Rounding 原生行情",
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }, {
        symbol: "HALF.CRYPTO",
        name: "Half Cent Crypto",
        quantity: "1",
        currency: "USD",
        assetClass: "crypto",
        currentPrice: { amount: "0.005", currency: "USD" },
        priceSource: "Rounding 原生行情",
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: exchangeRates(false),
      syncedAt: SYNCED_AT,
    }),
    sync: CURRENT_SYNC,
  }];
}

function manyRoundingSources(): AssetSourceSummary[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `source-rounding-${index + 1}`,
    kind: "valuation-fixture",
    label: `Rounding Source ${index + 1}`,
    accountId: `rounding-${index + 1}`,
    permissions: ["market-data", "account", "positions"],
    credentialReference: `test-secret-rounding-${index + 1}`,
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: `ROUND-${index + 1}`,
        name: `Rounding Position ${index + 1}`,
        quantity: "1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: "0.006", currency: "USD" },
        priceSource: "Rounding 原生行情",
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: exchangeRates(false),
      syncedAt: SYNCED_AT,
    }),
    sync: CURRENT_SYNC,
  } satisfies AssetSourceSummary));
}

function missingSourceFxSources(): AssetSourceSummary[] {
  return [{
    id: "source-missing-fx",
    kind: "longbridge",
    label: "Longbridge HKD Account",
    accountId: "longbridge:missing-fx",
    permissions: ["account", "positions", "market-data"],
    credentialReference: "test-secret-missing-fx",
    snapshot: {
      total: { amount: "586774.67", currency: "HKD" },
      holdings: [],
      exchangeRates: [],
      syncedAt: SYNCED_AT,
    },
    sync: CURRENT_SYNC,
  }];
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario");
  const sources = scenario === "rounding"
    ? roundingSources()
    : scenario === "rounding-many"
      ? manyRoundingSources()
      : scenario === "missing-source-fx"
        ? missingSourceFxSources()
      : standardSources({
        inverse: url.searchParams.get("fx") === "inverse",
        alphaAdjustment:
          scenario === "positive-residual"
            ? "1"
            : scenario === "negative-residual"
              ? "-1"
              : undefined,
      });
  const cards: Card[] = sources.map((source, index) => ({
    id: `asset-${source.id}`,
    kind: "asset",
    title: source.label,
    body: "估值浏览器测试来源",
    sourceId: source.id,
    span: index === 0 && sources.length > 1 ? 2 : 1,
  }));
  const services = getTestServices();
  await services.assetSources.replaceAll(sources);
  await services.assetCards.replaceAll(cards);
  return Response.json({ ok: true });
}
