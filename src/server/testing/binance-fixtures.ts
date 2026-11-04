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

export function binanceFixture() {
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
    ],
    flexiblePages: [
      {
        total: 2,
        rows: [{
          asset: "BNB",
          productId: "BNB001",
          totalAmount: "2",
          collateralAmount: "0",
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
        balance: "0.035833333333333333",
      },
      { walletName: "Cross Margin", balance: "0" },
      { walletName: "Isolated Margin", balance: "0" },
      { walletName: "USD-M Futures", balance: "0" },
      { walletName: "COIN-M Futures", balance: "0" },
      { walletName: "Options", balance: "0" },
      { walletName: "Trading Bots", balance: "0" },
      { walletName: "Copy Trading", balance: "0" },
    ],
    simpleEarnAccount: {
      totalAmountInBTC: "0.035833333333333333",
    },
    dualAccounts: { totalAmountInBTC: "0" },
    dualPages: [{ total: 0, list: [] }],
    discountAccount: { totalHoldingInUSDT: "0" },
    discountPages: [{ total: 0, list: [] }],
    bfusdAccount: {
      bfusdAmount: "0",
      usdtProfit: "0",
      bfusdProfit: "0",
    },
    rwusdAccount: {
      rwusdAmount: "0",
      totalProfit: "0",
    },
    ethStakingAccount: {
      holdingInETH: "0",
      thirtyDaysProfitInETH: "0",
    },
    solStakingAccount: {
      bnsolAmount: "0",
      holdingInSOL: "0",
      thirtyDaysProfitInSOL: "0",
    },
    onchainAccount: {
      totalAmountInBTC: "0",
      flexibleAmount: "0",
      totalFlexibleAmountInUSDT: "0",
    },
    onchainPages: [{ total: 0, rows: [] }],
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
