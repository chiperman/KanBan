import { decimalAdd, decimalDivide, decimalMultiply, decimalToFixed } from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { BinancePosition } from "./binance-positions";
import {
  eligibleUsdtSymbols,
  equityMidPrice,
  type BinanceEquityQuote,
  stocksSymbolForAsset,
  tickerPrices,
} from "./binance-market";
import type { AssetHolding, AssetSnapshot } from "@/server/ports";
import type { PriceQuote } from "../../sdk/host-capabilities";
import { compareSourceHoldingValue, effectiveUsdtUsdQuote } from "../../sdk/valuation-policy";
import { positiveDecimal } from "../../sdk/value-guards";

const { record, list, text, nonNegativeDecimal: decimal } = createJsonDecoder("Binance");
const positive = positiveDecimal;

function spotCostPriceDetails(
  position: BinancePosition,
  spotCostPrices: ReadonlyMap<string, string>,
): Pick<AssetHolding, "costPrice" | "costPriceSource"> {
  const costPrice = position.account === "spot"
    ? spotCostPrices.get(position.asset) ?? null
    : null;
  return costPrice === null
    ? { costPrice: null }
    : {
        costPrice,
        costPriceSource: "Binance 现货成交计算",
      };
}

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  switch (scope) {
    case "spot":
      return "现货";
    case "funding":
      return "资金";
    case "earn-flexible":
      return "活期 Earn";
    case "earn-locked":
      return "定期 Earn";
    case "earn":
      return "投资产品";
    case "staking":
      return "质押";
    default:
      return "Binance";
  }
}

export function reconcileWallet(input: {
  snapshot: AssetSnapshot;
  walletBalances: unknown;
  tickers: unknown;
  products: NonNullable<AssetSnapshot["coverage"]>["products"];
  incomplete: boolean;
}): AssetSnapshot {
  const rows = list(input.walletBalances, "Binance Wallet Balance 响应");
  const btcPrice = tickerPrices(
    input.tickers,
    new Set(["BTCUSDT"]),
  ).get("BTCUSDT") ?? null;
  let includedBtc = "0";
  const excludedPositiveAccounts: string[] = [];
  for (const row of rows) {
    const name = text(row.walletName, "walletName");
    const balance = decimal(row.balance, "balance");
    if (["Spot", "Funding", "Earn"].includes(name)) {
      includedBtc = decimalAdd(includedBtc, balance);
    } else if (positive(balance)) {
      excludedPositiveAccounts.push(name);
    }
  }
  if (btcPrice === null) {
    return {
      ...input.snapshot,
      coverage: {
        status: "partial",
        totalIsAuthoritative: false,
        products: input.products,
        unexplainedValue: null,
        excludedPositiveAccounts,
      },
    };
  }
  const walletValue = decimalAdd(
    decimalToFixed(decimalMultiply(includedBtc, btcPrice), 8),
  );
  return {
    ...input.snapshot,
    total: {
      amount: walletValue,
      currency: input.snapshot.total.currency,
    },
    coverage: {
      status: input.incomplete || excludedPositiveAccounts.length > 0
        ? "partial"
        : "complete",
      totalIsAuthoritative: excludedPositiveAccounts.length === 0,
      products: input.products,
      unexplainedValue: null,
      excludedPositiveAccounts,
    },
  };
}

export function nativeUsdtUsdQuote(
  exchangeInfo: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const root = record(exchangeInfo, "Binance exchangeInfo 响应");
  const available = list(root.symbols, "Binance exchangeInfo symbols").some((item) =>
    item.status === "TRADING" &&
    item.isSpotTradingAllowed !== false &&
    item.symbol === "USDTUSD" &&
    item.baseAsset === "USDT" &&
    item.quoteAsset === "USD"
  );
  if (!available) return null;
  const price = tickerPrices(
    tickers,
    new Set(["USDTUSD"]),
  ).get("USDTUSD") ?? null;
  if (price === null) return null;
  return {
    symbol: "USDT",
    currency: "USD",
    price,
    quotedAt: new Date(observedAt),
  };
}

export function valuePositions(input: {
  positions: BinancePosition[];
  exchangeInfo: unknown;
  tickers: unknown;
  equityQuotes?: ReadonlyMap<string, BinanceEquityQuote>;
  equityCostPrices?: ReadonlyMap<string, string>;
  spotCostPrices?: ReadonlyMap<string, string>;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  coverage?: AssetSnapshot["coverage"];
  authoritativeTotal?: AssetSnapshot["total"];
}): AssetSnapshot {
  const eligible = eligibleUsdtSymbols(input.exchangeInfo);
  const equityQuotes = input.equityQuotes ?? new Map<string, BinanceEquityQuote>();
  const equityCostPrices = input.equityCostPrices ?? new Map<string, string>();
  const spotCostPrices = input.spotCostPrices ?? new Map<string, string>();
  const neededSymbols = new Set(
    input.positions.flatMap((position) => {
      const symbol = `${position.asset}USDT`;
      return position.asset !== "USDT" && eligible.has(symbol) ? [symbol] : [];
    }),
  );
  const prices = tickerPrices(input.tickers, neededSymbols);
  const usdtUsdQuote = effectiveUsdtUsdQuote(input.usdtUsdQuote, input.observedAt);
  const usdtUsdSource = input.usdtUsdQuote === usdtUsdQuote
    ? input.usdtUsdSource ?? "CoinGecko Tether/USD 参考价格"
    : "USDT/USD 固定兜底（1:1）";
  let total = "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    if (position.asset === "USDT") {
      total = decimalAdd(total, position.quantity);
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: position.quantity,
        sourceMarketValue: {
          amount: position.quantity,
          currency: "USDT",
        },
        valuation: {
          status: "valued",
          priceSource: "Binance 账户 USDT 计价单位",
          pricedAt: input.observedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const stocksSymbol = stocksSymbolForAsset(position.asset);
    if (position.asset.startsWith("EQ_")) {
      const costPrice = stocksSymbol === null
        ? null
        : equityCostPrices.get(stocksSymbol) ?? null;
      const base = {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USD",
        assetClass: "securities" as const,
        costPrice,
        ...(costPrice === null
          ? {}
          : { costPriceSource: "Binance Stocks 订单成交计算（含费用）" }),
        platformProfit: null,
        changePercent: null,
      };
      if (stocksSymbol === null) {
        return {
          ...base,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued" as const,
            reason: `Binance Stocks 资产代码 ${position.asset} 无法解析为证券代码`,
          },
        };
      }
      const quote = equityQuotes.get(stocksSymbol) ?? null;
      if (quote === null) {
        return {
          ...base,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued" as const,
            reason: `Binance Stocks 未返回 ${stocksSymbol} 的可靠报价`,
          },
        };
      }
      const unitPrice = equityMidPrice(quote);
      const marketValue = decimalMultiply(position.quantity, unitPrice);
      total = decimalAdd(
        total,
        decimalDivide(marketValue, usdtUsdQuote.price),
      );
      return {
        ...base,
        currentPrice: { amount: unitPrice, currency: "USD" },
        marketValue,
        sourceMarketValue: { amount: marketValue, currency: "USD" },
        valuation: {
          status: "valued" as const,
          priceSource: `Binance Stocks ${stocksSymbol} 买一/卖一中间价`,
          pricedAt: input.observedAt,
        },
      };
    }
    const symbol = `${position.asset}USDT`;
    const price = eligible.has(symbol) ? prices.get(symbol) ?? null : null;
    if (price === null) {
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "unvalued",
          reason: `Binance 没有可靠的 ${symbol} 现货价格`,
        },
        ...spotCostPriceDetails(position, spotCostPrices),
        platformProfit: null,
        changePercent: null,
      };
    }
    const marketValue = decimalMultiply(position.quantity, price);
    total = decimalAdd(total, marketValue);
    return {
      symbol: position.asset,
      name: `${position.asset} · ${scopeLabel(position.account)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      sourceProduct: position.product,
      ...(position.providerPositionId === null
        ? {}
        : { providerPositionId: position.providerPositionId }),
      ...(position.providerState === null
        ? {}
        : { providerPositionState: position.providerState }),
      economicAssetKey: position.economicAssetKey,
      positionState: position.state,
      quantity: position.quantity,
      currency: "USDT",
      assetClass: "crypto",
      currentPrice: { amount: price, currency: "USDT" },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: "USDT" },
      valuation: {
        status: "valued",
        priceSource: `Binance 现货 ${symbol}`,
        pricedAt: input.observedAt,
      },
      ...spotCostPriceDetails(position, spotCostPrices),
      platformProfit: null,
      changePercent: null,
    };
  });
  holdings.sort(compareSourceHoldingValue);
  return {
    total: input.authoritativeTotal ?? { amount: total, currency: "USDT" },
    holdings,
    exchangeRates: [{
      baseCurrency: "USDT",
      quoteCurrency: "USD",
      rate: usdtUsdQuote.price,
      source: usdtUsdSource,
      observedAt: usdtUsdQuote.quotedAt.toISOString(),
    }],
    syncedAt: input.observedAt,
    ...(input.coverage === undefined ? {} : { coverage: input.coverage }),
  };
}
