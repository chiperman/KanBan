import type { AssetSnapshot, BitgetAccountMode } from "@/server/ports";

export function bitgetFixtureSnapshot(
  observedAt: string,
  accountMode: BitgetAccountMode = "classic",
): AssetSnapshot {
  const holdings = [
    ["BTC", "现货", "0.1", "60000", "6000", "spot"],
    ["ETH", "资金", "1", "3000", "3000", "funding"],
    ["USDT", "现货", "1000", "1", "1000", "spot"],
    ["ETH", "On-chain Elite", "0.1", "3000", "300", "staking", "onchain-elite", "elite-eth-1"],
    ["USDT", "SharkFin", "200", "1", "200", "earn", "sharkfin", "aggregate"],
    ["USDT", "Cash+（现金宝）", "299.15", "1", "299.15", "earn", "cash-plus", "aggregate"],
    ["SOL", "活期 Earn", "5", "100", "500", "earn-flexible"],
    ["BNB", "定期 Earn", "0.8", "500", "400", "earn-locked"],
    ["USDC", "资金", "80", "0.999", "79.92", "funding"],
    ["XRP", "现货", "15.468642", "0.5", "7.734321", "spot"],
  ] as const;
  return {
    total: { amount: "11941.13687228", currency: "USDT" },
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
          priceSource: `Bitget 现货 ${symbol}USDT`,
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
          product: "funding",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "savings-flexible",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "savings-fixed",
          capability: "detailed",
          freshness: "current",
          message: null,
        },
        {
          product: "cash-plus",
          capability: "aggregate-only",
          freshness: "current",
          message: "读取 Cash+ 账户 USDT 估值，不将 BTC 估值重复计入",
        },
        ...(accountMode === "classic"
          ? [
              {
                product: "futures-bot",
                capability: "aggregate-only" as const,
                freshness: "current" as const,
                message: "读取平台聚合账户权益，不展开机器人订单",
              },
              {
                product: "futures",
                capability: "aggregate-only" as const,
                freshness: "current" as const,
                message: "平台总额已覆盖普通合约相关权益，不与 Futures Bots 重复相加；不展开仓位、保证金或未实现盈亏",
              },
            ]
          : []),
        {
          product: "sharkfin",
          capability: "aggregate-only",
          freshness: "current",
          message: "读取 SharkFin 账户聚合估值，官方当前记录不提供逐仓本金",
        },
        {
          product: "onchain-elite",
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
