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

export function binanceFixture(missingPrice = false) {
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
    ],
    flexiblePages: [
      {
        total: 2,
        rows: [{ asset: "BNB", productId: "BNB001", totalAmount: "2" }],
      },
      {
        total: 2,
        rows: [{ asset: "USDT", productId: "USDT001", totalAmount: "100" }],
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
    exchangeInfo: {
      timezone: "UTC",
      symbols: [
        ["BTC", "BTCUSDT"],
        ["USDC", "USDCUSDT"],
        ["ETH", "ETHUSDT"],
        ["BNB", "BNBUSDT"],
        ["SOL", "SOLUSDT"],
        ["XRP", "XRPUSDT"],
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
    ],
  };
}

export const BINANCE_USDT_USD_QUOTE: PriceQuote = {
  symbol: "USDT",
  currency: "USD",
  price: "0.998",
  quotedAt: new Date(BINANCE_OBSERVED_AT),
};
