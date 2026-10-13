import { buildSnapshotFromPositions, type RawAssetPosition } from "@/domain/valuation";
import { getTestServices } from "@/server/composition";
import type { AssetExchangeRate, AssetSourceSummary, Card } from "@/server/ports";
import { testGuard } from "@/server/testing/route-support";

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
  alphaKind?: AssetSourceSummary["kind"];
  alphaLabel?: string;
}): AssetSourceSummary[] {
  const rates = exchangeRates(input.inverse);
  return [{
    id: "source-alpha",
    kind: input.alphaKind ?? "okx",
    label: input.alphaLabel ?? "Alpha Securities",
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
    kind: "okx",
    label: "Beta Crypto",
    accountId: "beta",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-beta",
    snapshot: buildSnapshotFromPositions({
      // 故意返回乱序持仓，确保页面统一按来源内可比较市值排序。
      positions: betaPositions().reverse(),
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
    kind: "okx",
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
    kind: "okx",
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

function longbridgeCashSources(): AssetSourceSummary[] {
  const snapshot = buildSnapshotFromPositions({
    positions: [{
      symbol: "AAPL.US",
      name: "Apple",
      quantity: "1",
      currency: "USD",
      assetClass: "securities",
      currentPrice: { amount: "100", currency: "USD" },
      priceSource: "Longbridge 实时行情",
      pricedAt: SYNCED_AT,
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }, {
      symbol: "CASH.USD",
      name: "账户现金",
      quantity: "677.82",
      currency: "USD",
      assetClass: "cash",
      currentPrice: { amount: "1", currency: "USD" },
      priceSource: "Longbridge 账户现金总额",
      pricedAt: SYNCED_AT,
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    }],
    sourceCurrency: "USD",
    exchangeRates: exchangeRates(false),
    syncedAt: SYNCED_AT,
    adjustment: "5",
  });
  snapshot.holdings = snapshot.holdings.map((holding) =>
    holding.assetClass === "cash"
      ? {
          ...holding,
          cashBalances: [{
            amount: "661.11",
            availableCash: "660.54",
            currency: "USD",
            frozenCash: "0.57",
            settlingCash: "0.57",
            withdrawCash: "660.54",
          }, {
            amount: "131.05",
            availableCash: "131.05",
            currency: "HKD",
            frozenCash: "0",
            settlingCash: "0",
            withdrawCash: "131.05",
          }],
        }
      : holding
  );
  return [{
    id: "source-longbridge-cash",
    kind: "longbridge",
    label: "Longbridge Cash Account",
    accountId: "longbridge:cash",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-longbridge-cash",
    snapshot,
    sync: CURRENT_SYNC,
  }];
}

function longbridgeOptionQuoteUnavailableSources(): AssetSourceSummary[] {
  return [{
    id: "source-longbridge-options",
    kind: "longbridge",
    label: "长桥美股",
    displayName: "长桥美股",
    accountId: "longbridge:options",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-longbridge-options",
    snapshot: {
      total: { amount: "69930.10", currency: "USD" },
      holdings: [{
        symbol: "NVDA.US",
        name: "NVIDIA",
        quantity: "1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: "69970.74", currency: "USD" },
        marketValue: "69970.74",
        sourceMarketValue: { amount: "69970.74", currency: "USD" },
        valuation: {
          status: "valued",
          priceSource: "Longbridge 实时行情",
          pricedAt: SYNCED_AT,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }, {
        symbol: "NVDA260805C210000.US",
        name: "NVDA 260805 210 Call",
        quantity: "-1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "quote-unavailable",
          reason: "Longbridge Open API 未接入期权行情",
        },
        costPrice: "0.450",
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: exchangeRates(false),
      syncedAt: SYNCED_AT,
    },
    sync: CURRENT_SYNC,
  }];
}

function binancePartialSources(): AssetSourceSummary[] {
  return [{
    id: "source-binance-partial",
    kind: "binance",
    label: "Binance 账户 · 测试",
    accountId: "binance:test",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-binance",
    snapshot: {
      total: { amount: "17199.5", currency: "USDT" },
      holdings: [{
        symbol: "USDT",
        name: "USDT · 投资产品",
        sourceAsset: "USDT",
        sourceAccount: "earn",
        sourceProduct: "dual-investment",
        providerPositionId: "test-current",
        economicAssetKey: "binance:earn:USDT",
        positionState: "active",
        quantity: "16599.5",
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: "16599.5",
        sourceMarketValue: { amount: "16599.5", currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "Binance 账户 USDT 计价单位",
          pricedAt: SYNCED_AT,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [{
        baseCurrency: "USDT",
        quoteCurrency: "USD",
        rate: "0.998",
        source: "CoinGecko Tether/USD 参考价格",
        observedAt: SYNCED_AT,
      }],
      syncedAt: SYNCED_AT,
      coverage: {
        status: "partial",
        products: [{
          product: "dual-investment",
          capability: "detailed",
          freshness: "current",
          message: null,
        }, {
          product: "smart-arbitrage",
          capability: "indirect",
          freshness: "current",
          message: "公开 API 没有专用明细，监测钱包残差",
        }],
        unexplainedValue: { amount: "600", currency: "USDT" },
        excludedPositiveAccounts: ["Trading Bots"],
      },
    },
    sync: CURRENT_SYNC,
  }];
}

function bitgetAuthoritativeTotalSources(): AssetSourceSummary[] {
  return [{
    id: "source-bitget-authoritative-total",
    kind: "bitget",
    label: "Bitget 账户 · 平台总额",
    accountId: "bitget:authoritative-total",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-bitget-authoritative-total",
    snapshot: {
      total: { amount: "17200", currency: "USDT" },
      holdings: [{
        symbol: "USDT",
        name: "USDT · 持仓明细",
        quantity: "16599.5",
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: "16599.5",
        sourceMarketValue: { amount: "16599.5", currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "Bitget 现货 USDTUSD",
          pricedAt: SYNCED_AT,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [{
        baseCurrency: "USDT",
        quoteCurrency: "USD",
        rate: "0.998",
        source: "Bitget 现货 USDTUSD",
        observedAt: SYNCED_AT,
      }],
      syncedAt: SYNCED_AT,
      coverage: {
        status: "partial",
        totalIsAuthoritative: true,
        products: [{
          product: "spot",
          capability: "detailed",
          freshness: "current",
          message: null,
        }],
        unexplainedValue: { amount: "600.5", currency: "USDT" },
        excludedPositiveAccounts: [],
      },
    },
    sync: CURRENT_SYNC,
  }];
}

function binanceAuthoritativeTotalSources(): AssetSourceSummary[] {
  return [{
    id: "source-binance-authoritative-total",
    kind: "binance",
    label: "Binance 账户 · 平台总额",
    accountId: "binance:authoritative-total",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-secret-binance-authoritative-total",
    snapshot: {
      total: { amount: "17200", currency: "USDT" },
      holdings: [{
        symbol: "USDT",
        name: "USDT · 持仓明细",
        sourceAsset: "USDT",
        sourceAccount: "earn",
        sourceProduct: "simple-earn-flexible",
        economicAssetKey: "binance:earn:USDT",
        positionState: "active",
        quantity: "16599.5",
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: "16599.5",
        sourceMarketValue: { amount: "16599.5", currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "Binance 现货 USDTUSDC",
          pricedAt: SYNCED_AT,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [{
        baseCurrency: "USDT",
        quoteCurrency: "USD",
        rate: "0.998",
        source: "Binance 现货 USDTUSD",
        observedAt: SYNCED_AT,
      }],
      syncedAt: SYNCED_AT,
      coverage: {
        status: "partial",
        totalIsAuthoritative: true,
        products: [{
          product: "simple-earn-flexible",
          capability: "detailed",
          freshness: "current",
          message: null,
        }],
        unexplainedValue: { amount: "600.5", currency: "USDT" },
        excludedPositiveAccounts: [],
      },
    },
    sync: CURRENT_SYNC,
  }];
}

function detailCoveragePartialSources(): AssetSourceSummary[] {
  return [
    {
      id: "source-okx-detail-partial",
      kind: "okx",
      label: "OKX 账户",
      accountId: "okx:detail-partial",
      permissions: ["market-data", "account", "positions"],
      credentialReference: "test-secret-okx-detail-partial",
      snapshot: {
        ...buildSnapshotFromPositions({
          positions: [{
            symbol: "USDT",
            name: "USDT · 交易机器人汇总",
            quantity: "100",
            currency: "USD",
            assetClass: "crypto",
            currentPrice: { amount: "1", currency: "USD" },
            priceSource: "OKX 平台汇总权益",
            pricedAt: SYNCED_AT,
            costPrice: null,
            platformProfit: null,
            changePercent: null,
          }],
          sourceCurrency: "USD",
          exchangeRates: exchangeRates(false),
          syncedAt: SYNCED_AT,
        }),
        coverage: {
          status: "complete",
          products: [{
            product: "trading-bot",
            capability: "aggregate-only",
            freshness: "current",
            message: "按币种读取汇总权益，不展开策略明细",
          }, {
            product: "onchain-earn",
            capability: "aggregate-only",
            freshness: "current",
            message: "平台总额已包含，当前仅提供产品汇总",
          }],
          unexplainedValue: null,
          excludedPositiveAccounts: [],
        },
      },
      sync: CURRENT_SYNC,
    },
    {
      id: "source-bitget-detail-partial",
      kind: "bitget",
      label: "Bitget 账户",
      accountId: "bitget:detail-partial",
      permissions: ["market-data", "account", "positions"],
      credentialReference: "test-secret-bitget-detail-partial",
      snapshot: {
        ...buildSnapshotFromPositions({
          positions: [{
            symbol: "USDT",
            name: "USDT · Earn 汇总",
            quantity: "50",
            currency: "USD",
            assetClass: "crypto",
            currentPrice: { amount: "1", currency: "USD" },
            priceSource: "Bitget 平台汇总资产",
            pricedAt: SYNCED_AT,
            costPrice: null,
            platformProfit: null,
            changePercent: null,
          }],
          sourceCurrency: "USD",
          exchangeRates: exchangeRates(false),
          syncedAt: SYNCED_AT,
        }),
        coverage: {
          status: "complete",
          products: [{
            product: "savings-flexible",
            capability: "aggregate-only",
            freshness: "current",
            message: "按币种保留平台汇总资产",
          }, {
            product: "sharkfin",
            capability: "aggregate-only",
            freshness: "current",
            message: "读取平台聚合估值，不展开逐仓本金",
          }],
          unexplainedValue: null,
          excludedPositiveAccounts: [],
        },
      },
      sync: CURRENT_SYNC,
    },
  ];
}

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario");
  const sources = scenario === "rounding"
    ? roundingSources()
    : scenario === "rounding-many"
      ? manyRoundingSources()
      : scenario === "missing-source-fx"
        ? missingSourceFxSources()
      : scenario === "longbridge-cash"
        ? longbridgeCashSources()
      : scenario === "longbridge-option-quote-unavailable"
        ? longbridgeOptionQuoteUnavailableSources()
      : scenario === "binance-coverage-partial"
        ? binancePartialSources()
      : scenario === "binance-authoritative-total"
        ? binanceAuthoritativeTotalSources()
      : scenario === "bitget-authoritative-total"
        ? bitgetAuthoritativeTotalSources()
      : scenario === "detail-coverage-partial"
        ? detailCoveragePartialSources()
      : standardSources({
        inverse: url.searchParams.get("fx") === "inverse",
        alphaKind: scenario === "okx-negative-residual" ? "okx" : undefined,
        alphaLabel: scenario === "okx-negative-residual" ? "OKX" : undefined,
        alphaAdjustment:
          scenario === "positive-residual"
            ? "1"
            : scenario === "negative-residual"
              ? "-1"
              : scenario === "okx-negative-residual"
                ? "-0.16"
              : undefined,
      });
  const cards: Card[] = sources.map((source, index) => ({
    id: `asset-${source.id}`,
    kind: "asset",
    title: source.label,
    body: "估值浏览器测试来源",
    sourceId: source.id,
    span:
      scenario === "binance-coverage-partial" ||
      scenario === "binance-authoritative-total"
      ? 2
      : index === 0 && sources.length > 1
        ? 2
        : 1,
  }));
  const services = getTestServices();
  // 估值场景保持可刷新，避免页面自动刷新因悬空凭据引用而制造过期状态。
  for (const source of sources) {
    source.credentialReference = await services.secrets.put(`${source.id}-valuation-test-secret`);
  }
  await services.assetSources.replaceAll(sources);
  await services.assetCards.replaceAll(cards);
  return Response.json({ ok: true });
}
