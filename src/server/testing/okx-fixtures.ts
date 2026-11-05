import type { AssetSnapshot } from "@/server/ports";

export function okxFixtureSnapshot(observedAt: string): AssetSnapshot {
  const holdings = [
    ["BTC", "现货", "0.1", "60000", "6000", "spot"],
    ["ETH", "资金", "1", "3000", "3000", "funding"],
    ["USDT", "现货", "1000", "1", "1000", "spot"],
    ["ETH", "链上 Earn", "0.2", "3000", "600", "staking", "onchain-earn", "okx-onchain-order-1"],
    ["SOL", "活期 Earn", "5", "100", "500", "earn-flexible"],
    ["BNB", "活期 Earn", "0.8", "500", "400", "earn-flexible"],
    ["USDC", "资金", "80.08008008008008", "0.999", "80", "funding"],
    ["XRP", "现货", "15.308642", "0.5", "7.654321", "spot"],
  ] as const;
  return {
    total: { amount: "11637.654321", currency: "USDT" },
    holdings: holdings.map(
      ([
        symbol,
        scope,
        quantity,
        price,
        marketValue,
        sourceAccount,
        sourceProduct,
        providerPositionId,
      ]) => ({
        symbol,
        name: `${symbol} · ${scope}`,
        sourceAsset: symbol,
        sourceAccount,
        ...(sourceProduct ? { sourceProduct } : {}),
        ...(providerPositionId ? { providerPositionId } : {}),
        quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: price, currency: "USDT" },
        marketValue,
        sourceMarketValue: { amount: marketValue, currency: "USDT" },
        valuation: {
          status: "valued" as const,
          priceSource: `OKX 现货 ${symbol}-USDT`,
          pricedAt: observedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }),
    ),
    exchangeRates: [{
      baseCurrency: "USDT",
      quoteCurrency: "USD",
      rate: "0.998",
      source: "CoinGecko Tether/USD 参考价格",
      observedAt,
    }],
    syncedAt: observedAt,
    coverage: {
      status: "complete",
      products: [
        {
          product: "spot",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "trading-bot",
          capability: "aggregate-only",
          freshness: "current",
          message: "按币种读取 Trading stgyEq，不展开机器人和策略明细",
        },
        {
          product: "funding",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "simple-earn-flexible",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "simple-earn-fixed",
          capability: "aggregate-only",
          freshness: "current",
          message: "平台 Earn 总额已包含，官方当前仓位 API 无法逐仓展开",
        },
        {
          product: "onchain-earn",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
      ],
      unexplainedValue: null,
      excludedPositiveAccounts: [],
    },
  };
}
