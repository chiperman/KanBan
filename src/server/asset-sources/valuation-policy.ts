import { decimalAdd, decimalCompare, decimalMultiply } from "@/domain/decimal";
import type {
  AssetHolding,
  AssetSnapshot,
  PriceQuote,
  Prices,
} from "@/server/ports";

/** 仅排序已处于同一来源计价货币的明细；未估值项稳定地放在末尾。 */
export function compareSourceHoldingValue(left: AssetHolding, right: AssetHolding): number {
  const leftValue = left.sourceMarketValue?.amount ?? null;
  const rightValue = right.sourceMarketValue?.amount ?? null;
  if (leftValue === null) return rightValue === null ? 0 : 1;
  if (rightValue === null) return -1;
  return decimalCompare(rightValue, leftValue);
}

export function effectiveUsdtUsdQuote(quote: PriceQuote | null | undefined, observedAt: string): PriceQuote {
  const age = quote
    ? Math.abs(Date.parse(observedAt) - quote.quotedAt.getTime())
    : Number.POSITIVE_INFINITY;
  if (
    quote?.symbol === "USDT" &&
    quote.currency === "USD" &&
    /^\d+(?:\.\d+)?$/.test(quote.price) &&
    decimalCompare(quote.price, "0") > 0 &&
    Number.isFinite(age) &&
    age <= 5 * 60_000
  ) return quote;

  // 保留引用身份，调用方据此区分真实报价与必须明确标注的固定兜底。
  return { symbol: "USDT", currency: "USD", price: "1", quotedAt: new Date(observedAt) };
}

export interface UsdtUsdValuation {
  quote: PriceQuote | null;
  /** Null means the fallback reference price was unavailable. */
  source: string | null;
}

export async function usdtUsdValuation(input: {
  native: PriceQuote | null;
  nativeSource: string;
  observedAt: string;
  prices: Pick<Prices, "quote">;
}): Promise<UsdtUsdValuation> {
  if (input.native) return { quote: input.native, source: input.nativeSource };
  const quote = await input.prices.quote("USDT");
  return { quote, source: null };
}

function positionKey(holding: AssetHolding): string {
  return [
    holding.sourceAccount ?? "default",
    holding.sourceProduct ?? "legacy",
    holding.providerPositionId ?? "aggregate",
    holding.sourceAsset ?? holding.symbol,
  ].join(":");
}

/**
 * 用上一次快照里更新的成交价回填新快照，避免行情抖动把已估值持仓退回旧价。
 * 计价口径由调用方显式给出：OKX 恒为 USDT，Bitget 跟随持仓自身货币与来源总额货币。
 */
export function preserveNewerPrices(
  previous: AssetSnapshot,
  candidate: AssetSnapshot,
  currencies: {
    holding: (source: AssetHolding) => string;
    total: string;
  },
): AssetSnapshot {
  const previousByPosition = new Map(
    previous.holdings.map((holding) => [positionKey(holding), holding]),
  );
  const holdings = candidate.holdings.map((holding) => {
    const prior = previousByPosition.get(positionKey(holding));
    if (
      prior?.valuation.status === "valued" &&
      holding.valuation.status === "valued" &&
      Date.parse(prior.valuation.pricedAt) > Date.parse(holding.valuation.pricedAt)
    ) {
      if (prior.currentPrice === null) return holding;
      const marketValue = decimalMultiply(
        holding.quantity,
        prior.currentPrice.amount,
      );
      return {
        ...holding,
        currentPrice: prior.currentPrice,
        marketValue,
        sourceMarketValue: {
          amount: marketValue,
          currency: currencies.holding(holding),
        },
        valuation: prior.valuation,
      };
    }
    return holding;
  });
  const total = holdings.reduce(
    (sum, holding) =>
      holding.sourceMarketValue
        ? decimalAdd(sum, holding.sourceMarketValue.amount)
        : sum,
    "0",
  );
  return {
    ...candidate,
    total: candidate.coverage?.status === "complete"
      ? candidate.total
      : { amount: total, currency: currencies.total },
    holdings: holdings.sort(compareSourceHoldingValue),
  };
}
