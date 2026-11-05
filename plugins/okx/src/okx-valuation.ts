import {
  decimalAdd,
  decimalCompare,
  decimalMultiply,
} from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { AssetHolding, AssetSnapshot } from "@/server/ports";
import type { PriceQuote } from "../../sdk/host-capabilities";
import { positiveDecimal } from "../../sdk/value-guards";
import {
  compareSourceHoldingValue,
  effectiveUsdtUsdQuote,
} from "../../sdk/valuation-policy";
import { first } from "./okx-json";
import type { OkxPosition } from "./okx-positions";

const { record, list, text, nonNegativeDecimal: decimal } = createJsonDecoder("OKX");
const positive = positiveDecimal;

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  if (scope === "spot") return "现货";
  if (scope === "trading-bot") return "交易机器人";
  if (scope === "funding") return "资金";
  if (scope === "earn-flexible") return "活期 Earn";
  if (scope === "staking") return "链上 Earn";
  return "OKX";
}

export function accountValuation(value: unknown): {
  total: string;
  coverage: NonNullable<AssetSnapshot["coverage"]>;
} {
  const row = first(value, "OKX asset/asset-valuation data");
  const total = decimal(row.totalBal, "totalBal");
  const timestamp = text(row.ts, "ts");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new Error("OKX asset-valuation ts 格式无效");
  }
  const details = record(row.details, "OKX asset-valuation details");
  decimal(details.trading, "details.trading");
  decimal(details.funding, "details.funding");
  decimal(details.earn, "details.earn");
  decimal(details.classic, "details.classic");
  return {
    total,
    coverage: okxCoverage(),
  };
}

function okxCoverage(): NonNullable<AssetSnapshot["coverage"]> {
  return {
    status: "complete",
    totalIsAuthoritative: true,
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
  };
}

export function nativeUsdtUsdQuote(
  instruments: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const available = list(instruments, "OKX instruments data").some((item) =>
    item.instType === "SPOT" &&
    item.state === "live" &&
    item.instId === "USDT-USD" &&
    item.baseCcy === "USDT" &&
    item.quoteCcy === "USD"
  );
  if (!available) return null;
  const item = list(tickers, "OKX tickers data").find(
    (candidate) => candidate.instId === "USDT-USD",
  );
  if (!item) return null;
  const timestamp = text(item.ts, "ts");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) return null;
  const quotedAt = new Date(Number(timestamp));
  const age = Math.abs(Date.parse(observedAt) - quotedAt.getTime());
  if (
    typeof item.last !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(item.last)
  ) {
    return null;
  }
  const price = item.last;
  if (!Number.isFinite(age) || age > 5 * 60_000 || !positive(price)) return null;
  return { symbol: "USDT", currency: "USD", price, quotedAt };
}

export function valuePositions(input: {
  positions: OkxPosition[];
  instruments: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  coverage?: AssetSnapshot["coverage"];
  authoritativeTotal?: AssetSnapshot["total"];
}): AssetSnapshot {
  const positionAssets = new Set(input.positions.map((position) => position.asset));
  const livePairs = new Map<string, string>();
  for (const item of list(input.instruments, "OKX instruments data")) {
    if (
      item.instType === "SPOT" &&
      item.state === "live" &&
      item.quoteCcy === "USDT"
    ) {
      const baseCcy = text(item.baseCcy, "baseCcy");
      if (positionAssets.has(baseCcy)) {
        livePairs.set(baseCcy, text(item.instId, "instId"));
      }
    }
  }
  const neededInstruments = new Set(livePairs.values());
  const tickerByInstrument = new Map<string, { price: string; pricedAt: string }>();
  for (const item of list(input.tickers, "OKX tickers data")) {
    const instrument = text(item.instId, "instId");
    if (!neededInstruments.has(instrument)) continue;
    const timestamp = text(item.ts, "ts");
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new Error("OKX ticker ts 格式无效");
    }
    const pricedAt = new Date(Number(timestamp));
    const age = Math.abs(Date.parse(input.observedAt) - pricedAt.getTime());
    if (!Number.isFinite(age) || age > 5 * 60_000) continue;
    if (
      typeof item.last !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(item.last)
    ) {
      continue;
    }
    const price = item.last;
    if (!positive(price)) continue;
    tickerByInstrument.set(instrument, {
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
    if (position.asset === "USDT") {
      total = decimalAdd(total, position.quantity);
      return {
        symbol: "USDT",
        name: `USDT · ${scopeLabel(position.account)}`,
        sourceAsset: "USDT",
        sourceAccount: position.account,
        ...(position.sourceProduct
          ? { sourceProduct: position.sourceProduct }
          : {}),
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        ...(position.providerPositionState
          ? { providerPositionState: position.providerPositionState }
          : {}),
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: position.quantity,
        sourceMarketValue: { amount: position.quantity, currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "OKX 账户 USDT 计价单位",
          pricedAt: input.observedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const instrument = livePairs.get(position.asset);
    const ticker = instrument ? tickerByInstrument.get(instrument) : undefined;
    if (!instrument || !ticker) {
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        ...(position.sourceProduct
          ? { sourceProduct: position.sourceProduct }
          : {}),
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        ...(position.providerPositionState
          ? { providerPositionState: position.providerPositionState }
          : {}),
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: input.coverage?.status === "complete"
          ? {
              status: "quote-unavailable",
              reason: `OKX 平台总额已包含，但没有可靠的 ${position.asset}-USDT 持仓行情`,
            }
          : {
              status: "unvalued",
              reason: `OKX 没有可靠的 ${position.asset}-USDT 现货价格`,
            },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const marketValue = decimalMultiply(position.quantity, ticker.price);
    total = decimalAdd(total, marketValue);
    return {
      symbol: position.asset,
      name: `${position.asset} · ${scopeLabel(position.account)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      ...(position.sourceProduct
        ? { sourceProduct: position.sourceProduct }
        : {}),
      ...(position.providerPositionId
        ? { providerPositionId: position.providerPositionId }
        : {}),
      ...(position.providerPositionState
        ? { providerPositionState: position.providerPositionState }
        : {}),
      quantity: position.quantity,
      currency: "USDT",
      assetClass: "crypto",
      currentPrice: { amount: ticker.price, currency: "USDT" },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: "USDT" },
      valuation: {
        status: "valued",
        priceSource: `OKX 现货 ${instrument}`,
        pricedAt: ticker.pricedAt,
      },
      costPrice: null,
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
