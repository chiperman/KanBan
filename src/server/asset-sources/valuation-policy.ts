import { decimalCompare } from "@/domain/decimal";
import type { AssetHolding, PriceQuote } from "@/server/ports";

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
