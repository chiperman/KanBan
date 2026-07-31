import type {
  AssetSnapshot,
  BitgetAccountMode,
  PriceQuote,
} from "@/server/ports";

export const BITGET_OBSERVED_AT = "2026-01-01T00:00:00.000Z";
export const BITGET_OBSERVED_MS = String(Date.parse(BITGET_OBSERVED_AT));

export const BITGET_USDT_USD_QUOTE: PriceQuote = {
  symbol: "USDT",
  currency: "USD",
  price: "0.998",
  quotedAt: new Date(BITGET_OBSERVED_AT),
};

export function bitgetAccountInfo(
  authorities: string[] = ["stor", "wtor"],
) {
  return {
    code: "00000",
    msg: "success",
    requestTime: Number(BITGET_OBSERVED_MS),
    data: {
      userId: "770001",
      inviterId: "660001",
      ips: "203.0.113.10",
      authorities,
      parentId: 770001,
      traderType: "not_trader",
      channelCode: "",
      channel: "",
      regisTime: "1764547200000",
    },
  };
}

export function bitgetUtaAccountInfo(
  permType = "read-only",
  permissions: string[] = ["uta_mgt", "uta_trade"],
) {
  return {
    code: "00000",
    msg: "success",
    requestTime: Number(BITGET_OBSERVED_MS),
    data: {
      userId: "770001",
      parentId: "",
      regisTime: "1764547200000",
      ips: "203.0.113.10",
      permType,
      permissions,
    },
  };
}

export function bitgetUtaApiFixture() {
  return {
    assets: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS) - 3_000,
      data: {
        unrealisedPnl: "0",
        positionValue: "0",
        mmr: "0",
        imr: "0",
        assets: [
          { coin: "BTC", balance: "0.1", equity: "0.1", usdValue: "6000", debt: "0", available: "0.08", locked: "0.02" },
          { coin: "USDT", balance: "1000", equity: "1000", usdValue: "998", debt: "0", available: "900", locked: "100" },
          { coin: "XRP", balance: "15.468642", equity: "15.468642", usdValue: "7.734321", debt: "0", available: "15.468642", locked: "0" },
        ],
      },
    },
    funding: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS) - 2_000,
      data: [
        { coin: "ETH", available: "0.9", frozen: "0.1", balance: "1" },
        { coin: "USDC", available: "70", frozen: "10", balance: "80" },
      ],
    },
    emptyProof: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: { list: [] as Array<Record<string, string>>, cursor: "" },
    },
  };
}

export function bitgetApiFixture() {
  const pairs: Array<[string, string]> = [
    ["BTC", "60000"],
    ["ETH", "3000"],
    ["SOL", "100"],
    ["BNB", "500"],
    ["USDC", "0.999"],
    ["XRP", "0.5"],
  ];
  return {
    time: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: { serverTime: BITGET_OBSERVED_MS },
    },
    spot: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: [
        { coin: "BTC", available: "0.08", frozen: "0.02", locked: "0", limitAvailable: "0", uTime: BITGET_OBSERVED_MS },
        { coin: "USDT", available: "900", frozen: "100", locked: "0", limitAvailable: "0", uTime: BITGET_OBSERVED_MS },
        { coin: "XRP", available: "15.468642", frozen: "0", locked: "0", limitAvailable: "0", uTime: BITGET_OBSERVED_MS },
      ],
    },
    funding: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS) - 2_000,
      data: [
        { coin: "ETH", available: "0.9", frozen: "0.1", usdtValue: "3000" },
        { coin: "USDC", available: "70", frozen: "10", usdtValue: "79.92" },
      ],
    },
    botFutures: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS) - 1_000,
      data: [{
        coin: "USDT",
        available: "84.61136285",
        equity: "154.33255128",
        bonus: "0",
        frozen: "",
        usdtValue: "154.33255128",
      }],
    },
    allAccountBalance: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: [
        { accountType: "spot", usdtBalance: "7007.734321" },
        { accountType: "futures", usdtBalance: "0" },
        { accountType: "funding", usdtBalance: "3079.92" },
        { accountType: "earn", usdtBalance: "1400" },
        { accountType: "bots", usdtBalance: "154.33255128" },
        { accountType: "margin", usdtBalance: "0" },
      ],
    },
    earnOverview: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: [
        { coin: "SOL", amount: "5" },
        { coin: "BNB", amount: "0.8" },
      ],
    },
    flexible: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: {
        resultList: [{
          productId: "flex-sol",
          productCoin: "SOL",
          interestCoin: "SOL",
          periodType: "flexible",
          holdAmount: "5",
          lastProfit: "0.01",
          totalProfit: "0.12",
          status: "in_holding",
          productLevel: "normal",
        }],
        endId: "",
      },
    },
    fixed: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: {
        resultList: [{
          productId: "fixed-bnb",
          orderId: "fixed-order-1",
          productCoin: "BNB",
          interestCoin: "BNB",
          periodType: "fixed",
          period: "30",
          holdAmount: "0.8",
          lastProfit: "0.01",
          totalProfit: "0.03",
          status: "in_holding",
          productLevel: "normal",
        }],
        endId: "",
      },
    },
    sharkfinAccount: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: {
        btcSubscribeAmount: "0.003333333333",
        usdtSubscribeAmount: "200",
        btcHistoricalAmount: "0",
        usdtHistoricalAmount: "0",
        btcTotalEarning: "0.00001",
        usdtTotalEarning: "0.6",
      },
    },
    eliteAssets: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: {
        resultList: [{
          productId: "elite-eth-1",
          productCoin: "ETH",
          holdingAmount: "0.1",
          usdtHoldingAmount: "300",
          exchangeRate: "3000",
          subscriptionCoin: "USDT",
          totalProfit: "0.02",
        }],
      },
    },
    instruments: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: pairs.map(([baseCoin]) => ({
        symbol: `${baseCoin}USDT`,
        baseCoin,
        quoteCoin: "USDT",
        status: "online",
      })),
    },
    tickers: {
      code: "00000",
      msg: "success",
      requestTime: Number(BITGET_OBSERVED_MS),
      data: pairs.map(([baseCoin, lastPr]) => ({
        symbol: `${baseCoin}USDT`,
        lastPr,
        ts: BITGET_OBSERVED_MS,
      })),
    },
  };
}

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
    ["SOL", "活期 Earn", "5", "100", "500", "earn-flexible"],
    ["BNB", "定期 Earn", "0.8", "500", "400", "earn-locked"],
    ["USDC", "资金", "80", "0.999", "79.92", "funding"],
    ["XRP", "现货", "15.468642", "0.5", "7.734321", "spot"],
  ] as const;
  return {
    total: { amount: "11641.98687228", currency: "USDT" },
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
