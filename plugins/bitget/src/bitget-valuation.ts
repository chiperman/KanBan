import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
} from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { AssetHolding, AssetSnapshot, BitgetAccountMode } from "@/server/ports";
import type { PriceQuote } from "../../sdk/host-capabilities";
import { positiveDecimal } from "../../sdk/value-guards";
import { compareSourceHoldingValue, effectiveUsdtUsdQuote } from "../../sdk/valuation-policy";
import type { BitgetPosition } from "./bitget-positions";

const { record, list, text, nonNegativeDecimal: decimal } = createJsonDecoder("Bitget");
const positive = positiveDecimal;

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  if (scope === "spot") return "现货";
  if (scope === "funding") return "资金";
  if (scope === "trading-bot") return "合约交易机器人";
  if (scope === "earn-flexible") return "活期 Earn";
  if (scope === "earn-locked") return "定期 Earn";
  if (scope === "earn") return "Earn";
  if (scope === "staking") return "On-chain Elite";
  return "Bitget";
}

function positionScopeLabel(position: BitgetPosition): string {
  return position.sourceProduct === "cash-plus"
    ? "Cash+（现金宝）"
    : scopeLabel(position.account);
}

export function bitgetCoverage(
  accountMode: BitgetAccountMode,
  positions: readonly BitgetPosition[],
  input: {
    status: NonNullable<AssetSnapshot["coverage"]>["status"];
    unexplainedValue: NonNullable<
      AssetSnapshot["coverage"]
    >["unexplainedValue"];
    excludedPositiveAccounts: string[];
  },
): NonNullable<AssetSnapshot["coverage"]> {
  const hasAggregateEarn = positions.some(
    ({ sourceProduct }) => sourceProduct === "savings",
  );
  const savingsCapability = hasAggregateEarn
    ? "aggregate-only" as const
    : "detailed" as const;
  const savingsMessage = hasAggregateEarn
    ? "Earn 总览与逐仓明细不一致，按币种保留平台汇总资产"
    : null;
  const products: NonNullable<AssetSnapshot["coverage"]>["products"] = [
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
      capability: savingsCapability,
      freshness: "current",
      message: savingsMessage,
    },
    {
      product: "savings-fixed",
      capability: savingsCapability,
      freshness: "current",
      message: savingsMessage,
    },
    {
      product: "cash-plus",
      capability: "aggregate-only",
      freshness: "current",
      message: "读取 Cash+ 账户 USDT 估值，不将 BTC 估值重复计入",
    },
  ];
  if (accountMode === "classic") {
    products.push(
      {
        product: "futures-bot",
        capability: "aggregate-only",
        freshness: "current",
        message: "读取平台聚合账户权益，不展开机器人订单",
      },
      {
        product: "futures",
        capability: "aggregate-only",
        freshness: "current",
        message: "平台总额已覆盖普通合约相关权益，不与 Futures Bots 重复相加；不展开仓位、保证金或未实现盈亏",
      },
    );
  }
  products.push(
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
  );
  return {
    status: input.status,
    totalIsAuthoritative: input.excludedPositiveAccounts.length === 0,
    products,
    unexplainedValue: input.unexplainedValue,
    excludedPositiveAccounts: input.excludedPositiveAccounts,
  };
}

export function classicAccountCoverage(input: {
  overview: unknown;
  positions: readonly BitgetPosition[];
}): {
  total: AssetSnapshot["total"];
  coverage: NonNullable<AssetSnapshot["coverage"]>;
} {
  const balances = new Map<string, string>();
  for (
    const item of list(
      input.overview,
      "Bitget account/all-account-balance data",
    )
  ) {
    const accountType = text(item.accountType, "accountType");
    if (balances.has(accountType)) {
      throw new Error("Bitget 全账户总览出现重复 accountType");
    }
    balances.set(
      accountType,
      decimal(item.usdtBalance, "usdtBalance"),
    );
  }
  const totalTypes = ["spot", "funding", "earn", "bots", "futures"] as const;
  const excludedPositiveAccounts = [...balances.entries()]
    .filter(([accountType, amount]) =>
      !totalTypes.includes(accountType as typeof totalTypes[number]) &&
      positive(amount)
    )
    .map(([accountType]) => accountType);
  const total = decimalAdd(
    ...totalTypes.map((accountType) => balances.get(accountType) ?? "0"),
    ...input.positions
      .filter(({ sourceProduct }) => sourceProduct === "cash-plus")
      .map(({ nativeValue }) =>
        nativeValue?.currency === "USDT" ? nativeValue.amount : "0"
      ),
  );
  return {
    total: { amount: total, currency: "USDT" },
    coverage: bitgetCoverage("classic", input.positions, {
        status: excludedPositiveAccounts.length === 0 ? "complete" : "partial",
        unexplainedValue: null,
        excludedPositiveAccounts,
      }),
  };
}

export function nativeUsdtUsdQuote(
  instruments: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const available = list(instruments, "Bitget instruments data").some((item) =>
    item.status === "online" &&
    item.symbol === "USDTUSD" &&
    item.baseCoin === "USDT" &&
    item.quoteCoin === "USD"
  );
  if (!available) return null;
  const item = list(tickers, "Bitget tickers data").find(
    (candidate) => candidate.symbol === "USDTUSD",
  );
  if (!item) return null;
  const timestamp = typeof item.ts === "string" ? item.ts : "";
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) return null;
  const quotedAt = new Date(Number(timestamp));
  const age = Math.abs(Date.parse(observedAt) - quotedAt.getTime());
  const price = typeof item.lastPr === "string" &&
      /^\d+(?:\.\d+)?$/.test(item.lastPr)
    ? item.lastPr
    : null;
  if (
    price === null ||
    !Number.isFinite(age) ||
    age > 5 * 60_000 ||
    !positive(price)
  ) return null;
  return { symbol: "USDT", currency: "USD", price, quotedAt };
}


export function valuePositions(input: {
  positions: BitgetPosition[];
  instruments: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  targetCurrency: "USDT" | "USD";
  coverage?: AssetSnapshot["coverage"];
  authoritativeTotal?: AssetSnapshot["total"];
}): AssetSnapshot {
  const positionAssetKeys = new Set(
    input.positions.map((position) => position.asset.toUpperCase()),
  );
  const livePairs = new Map<string, { asset: string; symbol: string }>();
  const normalizedPairs = new Map<string, Array<{ asset: string; symbol: string }>>();
  for (const item of list(input.instruments, "Bitget instruments data")) {
    if (item.status === "online" && item.quoteCoin === "USDT") {
      if (
        typeof item.baseCoin !== "string" ||
        item.baseCoin.length === 0 ||
        !positionAssetKeys.has(item.baseCoin.toUpperCase()) ||
        typeof item.symbol !== "string" ||
        item.symbol.length === 0
      ) {
        continue;
      }
      const pair = {
        asset: item.baseCoin,
        symbol: item.symbol,
      };
      livePairs.set(pair.asset, pair);
      const key = pair.asset.toUpperCase();
      normalizedPairs.set(key, [...(normalizedPairs.get(key) ?? []), pair]);
    }
  }
  const neededInstruments = new Set(
    [...livePairs.values()].map((pair) => pair.symbol),
  );
  const tickerByInstrument = new Map<string, { price: string; pricedAt: string }>();
  for (const item of list(input.tickers, "Bitget tickers data")) {
    const symbol = typeof item.symbol === "string" ? item.symbol : null;
    if (symbol === null || !neededInstruments.has(symbol)) continue;
    const timestamp = typeof item.ts === "string" ? item.ts : "";
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      continue;
    }
    const pricedAt = new Date(Number(timestamp));
    const age = Math.abs(Date.parse(input.observedAt) - pricedAt.getTime());
    if (!Number.isFinite(age) || age > 5 * 60_000) continue;
    const price = typeof item.lastPr === "string" &&
        /^\d+(?:\.\d+)?$/.test(item.lastPr)
      ? item.lastPr
      : null;
    if (price === null || !positive(price)) continue;
    tickerByInstrument.set(symbol, {
      price,
      pricedAt: pricedAt.toISOString(),
    });
  }
  const usdtUsdQuote = effectiveUsdtUsdQuote(input.usdtUsdQuote, input.observedAt);
  const usdtUsdSource = input.usdtUsdQuote === usdtUsdQuote
    ? input.usdtUsdSource ?? "CoinGecko Tether/USD 参考价格"
    : "USDT/USD 固定兜底（1:1）";
  let total = "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    const pair = livePairs.get(position.asset) ?? (() => {
      const matches = normalizedPairs.get(position.asset.toUpperCase()) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    })();
    const displayAsset = pair?.asset ?? position.asset;
    let price: string | null = null;
    let marketValue: string | null = null;
    let pricedAt = input.observedAt;
    let priceSource = "";
    const nativeAge = position.nativeValue
      ? Math.abs(Date.parse(input.observedAt) - Date.parse(position.nativeValue.pricedAt))
      : Number.POSITIVE_INFINITY;
    if (
      position.nativeValue &&
      position.nativeValue.currency === input.targetCurrency &&
      positive(position.nativeValue.amount) &&
      Number.isFinite(nativeAge) &&
      nativeAge <= 5 * 60_000
    ) {
      marketValue = position.nativeValue.amount;
      price = decimalDivide(position.nativeValue.amount, position.quantity);
      pricedAt = position.nativeValue.pricedAt;
      priceSource = position.nativeValue.source;
    } else if (
      position.nativeValue &&
      position.nativeValue.currency === "USDT" &&
      input.targetCurrency === "USD" &&
      positive(position.nativeValue.amount) &&
      Number.isFinite(nativeAge) &&
      nativeAge <= 5 * 60_000
    ) {
      marketValue = decimalMultiply(
        position.nativeValue.amount,
        usdtUsdQuote.price,
      );
      price = decimalDivide(marketValue, position.quantity);
      pricedAt = position.nativeValue.pricedAt;
      priceSource = `${position.nativeValue.source} × ${usdtUsdSource}`;
    } else if (
      displayAsset === "USDT" &&
      input.targetCurrency === "USDT"
    ) {
      price = "1";
      marketValue = position.quantity;
      priceSource = "Bitget 账户 USDT 计价单位";
    } else if (
      displayAsset === "USDT" &&
      input.targetCurrency === "USD"
    ) {
      price = usdtUsdQuote.price;
      marketValue = decimalMultiply(position.quantity, price);
      pricedAt = usdtUsdQuote.quotedAt.toISOString();
      priceSource = usdtUsdSource;
    } else {
      const ticker = pair ? tickerByInstrument.get(pair.symbol) : undefined;
      if (ticker) {
        price = input.targetCurrency === "USDT"
          ? ticker.price
          : decimalMultiply(ticker.price, usdtUsdQuote.price);
        if (price !== null) {
          marketValue = decimalMultiply(position.quantity, price);
          pricedAt = ticker.pricedAt;
          priceSource = input.targetCurrency === "USDT"
            ? `Bitget 现货 ${pair?.symbol}`
            : `Bitget 现货 ${pair?.symbol} × ${usdtUsdSource}`;
        }
      }
    }
    if (price === null || marketValue === null) {
      return {
        symbol: displayAsset,
        name: `${displayAsset} · ${positionScopeLabel(position)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.sourceProduct,
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        quantity: position.quantity,
        currency: input.targetCurrency,
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: input.authoritativeTotal
          ? {
              status: "quote-unavailable",
              reason: `Bitget 平台总额已包含，但没有可靠的 ${displayAsset} ${input.targetCurrency} 持仓行情`,
            }
          : {
              status: "unvalued",
              reason: `Bitget 没有可靠的 ${displayAsset} ${input.targetCurrency} 估值`,
            },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    total = decimalAdd(total, marketValue);
    return {
      symbol: displayAsset,
      name: `${displayAsset} · ${positionScopeLabel(position)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      sourceProduct: position.sourceProduct,
      ...(position.providerPositionId
        ? { providerPositionId: position.providerPositionId }
        : {}),
      quantity: position.quantity,
      currency: input.targetCurrency,
      assetClass: "crypto",
      currentPrice: { amount: price, currency: input.targetCurrency },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: input.targetCurrency },
      valuation: {
        status: "valued",
        priceSource,
        pricedAt,
      },
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    };
  });
  holdings.sort(compareSourceHoldingValue);
  return {
    total: input.authoritativeTotal ?? {
      amount: total,
      currency: input.targetCurrency,
    },
    holdings,
    exchangeRates: input.targetCurrency === "USDT"
      ? [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: usdtUsdQuote.price,
          source: usdtUsdSource,
          observedAt: usdtUsdQuote.quotedAt.toISOString(),
        }]
      : [],
    syncedAt: input.observedAt,
    ...(input.coverage === undefined ? {} : { coverage: input.coverage }),
  };
}
