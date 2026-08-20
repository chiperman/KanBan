import type { PriceQuote } from "@/server/ports";

export const BINANCE_OBSERVED_AT = "2026-01-01T00:00:00.000Z";

export const BINANCE_READ_ONLY_PERMISSIONS = {
  ipRestrict: true,
  createTime: 1_700_000_000_000,
  enableReading: true,
  enableSpotAndMarginTrading: false,
  enableMargin: false,
  enableFutures: false,
  enablePortfolioMarginTrading: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: false,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
};

export function binancePermissions(scenario: string): Record<string, unknown> {
  const value: Record<string, unknown> = { ...BINANCE_READ_ONLY_PERMISSIONS };
  const fields: Record<string, string> = {
    trade: "enableSpotAndMarginTrading",
    withdraw: "enableWithdrawals",
    "internal-transfer": "enableInternalTransfer",
    "universal-transfer": "permitsUniversalTransfer",
    margin: "enableMargin",
    futures: "enableFutures",
    "portfolio-margin": "enablePortfolioMarginTrading",
    options: "enableVanillaOptions",
    "fix-trade": "enableFixApiTrade",
  };
  if (fields[scenario]) value[fields[scenario]] = true;
  if (scenario === "unknown-write") value.enableNewTradingCapability = true;
  if (scenario === "missing-proof") delete value.enableWithdrawals;
  if (scenario === "no-reading") value.enableReading = false;
  return value;
}

export function binanceFixture(
  missingPrice = false,
  collateralReceipt = false,
  dust = false,
  investmentScenario: "baseline" | "investments" | "wallet-gap" | "unknown-state" | "wrapped-staking" = "baseline",
  equityHolding = false,
) {
  const includesInvestments = investmentScenario !== "baseline";
  const walletGap = investmentScenario === "wallet-gap";
  const unknownState = investmentScenario === "unknown-state";
  const wrappedStaking = investmentScenario === "wrapped-staking";
  return {
    spotAccount: {
      makerCommission: 10,
      takerCommission: 10,
      canTrade: true,
      canWithdraw: true,
      accountType: "SPOT",
      uid: 900001,
      balances: [
        { asset: "BTC", free: "0.1", locked: "0" },
        { asset: "USDT", free: "1000", locked: "0" },
        { asset: "USDC", free: "500", locked: "0" },
        ...(wrappedStaking
          ? [
              { asset: "WBETH", free: "0.5", locked: "0" },
              { asset: "BNSOL", free: "2", locked: "0" },
            ]
          : []),
        ...(dust ? [{ asset: "DUST", free: "5", locked: "0" }] : []),
        ...(collateralReceipt
          ? [
              { asset: "LDBNB", free: "1.5", locked: "0" },
              { asset: "LDORPHAN", free: "4", locked: "0" },
            ]
          : []),
        ...(missingPrice
          ? [{ asset: "UNKNOWN", free: "8.123456789", locked: "0" }]
          : []),
      ],
    },
    fundingAssets: [
      {
        asset: "ETH",
        free: "1",
        locked: "0",
        freeze: "0",
        withdrawing: "0",
        btcValuation: "0.05",
      },
      {
        asset: "USDT",
        free: "200",
        locked: "0",
        freeze: "0",
        withdrawing: "0",
        btcValuation: "0.0033",
      },
      ...(equityHolding
        ? [{
            asset: "EQ_GLD",
            free: "1.0310215",
            locked: "0",
            freeze: "0",
            withdrawing: "0",
            btcValuation: "0.0061",
          }]
        : []),
    ],
    flexiblePages: [
      {
        total: 2,
        rows: [{
          asset: "BNB",
          productId: "BNB001",
          totalAmount: "2",
          collateralAmount: collateralReceipt ? "1.25" : "0",
        }],
      },
      {
        total: 2,
        rows: [{
          asset: "USDT",
          productId: "USDT001",
          totalAmount: "100",
          collateralAmount: "0",
        }],
      },
    ],
    lockedPages: [
      {
        total: 2,
        rows: [{
          asset: "SOL",
          positionId: 11_000_000_001,
          projectId: "SOL90",
          amount: "10",
          status: "HOLDING",
        }],
      },
      {
        total: 2,
        rows: [{
          asset: "XRP",
          positionId: 11_000_000_002,
          projectId: "XRP90",
          amount: "100",
          status: "HOLDING",
        }],
      },
    ],
    walletBalances: [
      { walletName: "Spot", balance: "0.124991666666666667" },
      { walletName: "Funding", balance: "0.053333333333333333" },
      {
        walletName: "Earn",
        balance: includesInvestments
          ? walletGap
            ? "0.108333333333333333"
            : "0.098333333333333333"
          : "0.035833333333333333",
      },
      { walletName: "Cross Margin", balance: "0" },
      { walletName: "Isolated Margin", balance: "0" },
      { walletName: "USD-M Futures", balance: "0" },
      { walletName: "COIN-M Futures", balance: "0" },
      { walletName: "Options", balance: "0" },
      { walletName: "Trading Bots", balance: walletGap ? "0.001" : "0" },
      { walletName: "Copy Trading", balance: "0" },
    ],
    simpleEarnAccount: {
      totalAmountInBTC: includesInvestments ? "0.098333333333333333" : "0.035833333333333333",
    },
    dualAccounts: { totalAmountInBTC: includesInvestments ? "0.01" : "0" },
    dualPages: includesInvestments
      ? [
          {
            total: 2,
            list: [{
              orderId: "dual-settled",
              investCoin: "BTC",
              subscriptionAmount: "0.02",
              purchaseStatus: "SETTLED",
            }],
          },
          {
            total: 2,
            list: [{
              orderId: "dual-current",
              investCoin: "BTC",
              subscriptionAmount: "0.01",
              purchaseStatus: unknownState ? "NEW_PROVIDER_STATE" : "PURCHASE_SUCCESS",
            }],
          },
        ]
      : [{ total: 0, list: [] }],
    discountAccount: { totalHoldingInUSDT: includesInvestments ? "250" : "0" },
    discountPages: includesInvestments
      ? [
          {
            total: 2,
            list: [{
              positionId: "discount-current",
              subscriptionAsset: "USDT",
              subscriptionAmount: "250",
              status: "SETTLING",
            }],
          },
          {
            total: 2,
            list: [{
              positionId: "discount-settled",
              subscriptionAsset: "USDT",
              subscriptionAmount: "100",
              status: "SETTLED",
            }],
          },
        ]
      : [{ total: 0, list: [] }],
    bfusdAccount: {
      bfusdAmount: includesInvestments ? "300" : "0",
      usdtProfit: "0",
      bfusdProfit: "0",
    },
    rwusdAccount: {
      rwusdAmount: includesInvestments ? "400" : "0",
      totalProfit: "0",
    },
    ethStakingAccount: {
      holdingInETH: includesInvestments ? "0.5" : "0",
      thirtyDaysProfitInETH: "0",
    },
    solStakingAccount: {
      bnsolAmount: includesInvestments ? "2" : "0",
      holdingInSOL: includesInvestments ? "2" : "0",
      thirtyDaysProfitInSOL: "0",
    },
    onchainAccount: {
      totalAmountInBTC: includesInvestments ? "0.008333333333333333" : "0",
      flexibleAmount: "0",
      totalFlexibleAmountInUSDT: "0",
    },
    onchainPages: includesInvestments
      ? [{
          total: 1,
          rows: [{
            positionId: "onchain-current",
            asset: "BNB",
            amount: "1",
            status: "HOLDING",
          }],
        }]
      : [{ total: 0, rows: [] }],
    softStaking: [{ asset: "BTC", stakedAmount: "0", totalProfit: "0.001" }],
    exchangeInfo: {
      timezone: "UTC",
      symbols: [
        ["BTC", "BTCUSDT"],
        ["USDC", "USDCUSDT"],
        ["ETH", "ETHUSDT"],
        ["BNB", "BNBUSDT"],
        ["SOL", "SOLUSDT"],
        ["XRP", "XRPUSDT"],
        ["BFUSD", "BFUSDUSDT"],
        ["RWUSD", "RWUSDUSDT"],
        ...(wrappedStaking
          ? [["WBETH", "WBETHUSDT"], ["BNSOL", "BNSOLUSDT"]]
          : []),
        ...(dust ? [["DUST", "DUSTUSDT"]] : []),
      ].map(([baseAsset, symbol]) => ({
        symbol,
        status: "TRADING",
        baseAsset,
        quoteAsset: "USDT",
        isSpotTradingAllowed: true,
      })),
    },
    tickers: [
      { symbol: "BTCUSDT", price: "60000" },
      { symbol: "USDCUSDT", price: "0.999" },
      { symbol: "ETHUSDT", price: "3000" },
      { symbol: "BNBUSDT", price: "500" },
      { symbol: "SOLUSDT", price: "100" },
      { symbol: "XRPUSDT", price: "0.5" },
      { symbol: "BFUSDUSDT", price: "1" },
      { symbol: "RWUSDUSDT", price: "1" },
      ...(wrappedStaking
        ? [
            { symbol: "WBETHUSDT", price: "3000" },
            { symbol: "BNSOLUSDT", price: "100" },
          ]
        : []),
      ...(dust ? [{ symbol: "DUSTUSDT", price: "0.1" }] : []),
    ],
    spotTrades: {
      BTCUSDT: [{
        symbol: "BTCUSDT",
        id: 1,
        orderId: 1,
        price: "50000",
        qty: "0.1",
        quoteQty: "5000",
        commission: "5",
        commissionAsset: "USDT",
        time: Date.parse(BINANCE_OBSERVED_AT),
        isBuyer: true,
      }],
    },
    equityOrders: {
      GLD: [{
        orderId: "gld-order-1",
        symbol: "GLD",
        side: "BUY",
        filledQty: "1",
        filledTotal: "360",
        fee: "0.20",
        updatedAt: Date.parse(BINANCE_OBSERVED_AT) - 2_000,
      }, {
        orderId: "gld-order-2",
        symbol: "GLD",
        side: "BUY",
        filledQty: "0.0310215",
        filledTotal: "11.3228475",
        fee: "0.01",
        updatedAt: Date.parse(BINANCE_OBSERVED_AT) - 1_000,
      }],
    },
    equityQuotes: new Map([
      ["GLD", {
        symbol: "GLD",
        bidPrice: "370",
        askPrice: "372",
      }],
    ]),
  };
}

export const BINANCE_USDT_USD_QUOTE: PriceQuote = {
  symbol: "USDT",
  currency: "USD",
  price: "0.998",
  quotedAt: new Date(BINANCE_OBSERVED_AT),
};
