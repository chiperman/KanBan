import type { AssetSnapshot, PriceQuote } from "@/server/ports";

export const OKX_OBSERVED_AT = "2026-01-01T00:00:00.000Z";
export const OKX_OBSERVED_MS = String(Date.parse(OKX_OBSERVED_AT));

export const OKX_USDT_USD_QUOTE: PriceQuote = {
  symbol: "USDT",
  currency: "USD",
  price: "0.998",
  quotedAt: new Date(OKX_OBSERVED_AT),
};

export function okxAccountConfig(perm = "read_only") {
  return {
    code: "0",
    msg: "",
    data: [{
      uid: "880001",
      mainUid: "880001",
      type: "0",
      label: "Personal Asset Dashboard",
      perm,
      acctLv: "1",
      enableSpotBorrow: false,
      spotBorrowAutoRepay: false,
      autoLoan: false,
      ip: "203.0.113.10",
    }],
  };
}

export function okxApiFixture() {
  const pairs = [
    ["BTC", "60000"],
    ["ETH", "3000"],
    ["SOL", "100"],
    ["BNB", "500"],
    ["USDC", "0.999"],
    ["XRP", "0.5"],
  ] as const;
  return {
    time: {
      code: "0",
      msg: "",
      data: [{ ts: OKX_OBSERVED_MS }],
    },
    options: {
      code: "0",
      msg: "",
      data: [] as Array<Record<string, string>>,
    },
    trading: {
      code: "0",
      msg: "",
      data: [{
        totalEq: "0",
        details: [
          {
            ccy: "BTC",
            cashBal: "0.1",
            availBal: "0.08",
            frozenBal: "0.02",
            liab: "",
            crossLiab: "0",
            borrowFroz: "0",
            interest: "0",
          },
          {
            ccy: "USDT",
            cashBal: "1000",
            availBal: "900",
            frozenBal: "100",
            liab: "0",
            crossLiab: "",
            borrowFroz: "",
            interest: "",
          },
          {
            ccy: "XRP",
            cashBal: "15.468642",
            availBal: "15.468642",
            frozenBal: "0",
            liab: "0",
            crossLiab: "0",
            borrowFroz: "0",
            interest: "0",
          },
        ],
      }],
    },
    funding: {
      code: "0",
      msg: "",
      data: [
        { ccy: "ETH", bal: "1", availBal: "0.9", frozenBal: "0.1" },
        { ccy: "USDC", bal: "80", availBal: "70", frozenBal: "10" },
      ],
    },
    savings: {
      code: "0",
      msg: "",
      data: [
        {
          ccy: "SOL",
          amt: "5",
          earnings: "0.12",
          loanAmt: "100",
          pendingAmt: "20",
          redemptAmt: "10",
        },
        {
          ccy: "BNB",
          amt: "0.8",
          earnings: "0.01",
          loanAmt: "0",
          pendingAmt: "0",
          redemptAmt: "0",
        },
      ],
    },
    instruments: {
      code: "0",
      msg: "",
      data: pairs.map(([baseCcy]) => ({
        instType: "SPOT",
        instId: `${baseCcy}-USDT`,
        baseCcy,
        quoteCcy: "USDT",
        state: "live",
      })),
    },
    tickers: {
      code: "0",
      msg: "",
      data: pairs.map(([baseCcy, last]) => ({
        instType: "SPOT",
        instId: `${baseCcy}-USDT`,
        last: String(last),
        ts: OKX_OBSERVED_MS,
      })),
    },
  };
}

export function okxFixtureSnapshot(observedAt: string): AssetSnapshot {
  const holdings = [
    ["BTC", "现货", "0.1", "60000", "6000", "spot"],
    ["ETH", "资金", "1", "3000", "3000", "funding"],
    ["USDT", "现货", "1000", "1", "1000", "spot"],
    ["SOL", "活期 Earn", "5", "100", "500", "earn-flexible"],
    ["BNB", "活期 Earn", "0.8", "500", "400", "earn-flexible"],
    ["USDC", "资金", "80.08008008008008", "0.999", "80", "funding"],
    ["XRP", "现货", "15.308642", "0.5", "7.654321", "spot"],
  ] as const;
  return {
    total: { amount: "10987.654321", currency: "USDT" },
    holdings: holdings.map(
      ([symbol, scope, quantity, price, marketValue, sourceAccount]) => ({
        symbol,
        name: `${symbol} · ${scope}`,
        sourceAsset: symbol,
        sourceAccount,
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
  };
}
