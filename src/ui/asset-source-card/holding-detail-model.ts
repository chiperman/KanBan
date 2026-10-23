import { decimalCompare, decimalDivide, decimalMultiply, decimalSubtract, decimalToFixed } from "@/domain/decimal";
import type { AssetHolding } from "@/server/ports";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

export function amount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function holdingProfit(holding: AssetHolding): {
  amount: string;
  percent: string;
} | null {
  if (
    holding.currentPrice === null ||
    holding.costPrice === null ||
    holding.currentPrice.currency !== holding.currency
  ) {
    return null;
  }
  const costBasis = decimalMultiply(holding.costPrice, holding.quantity);
  if (decimalCompare(costBasis, "0") === 0) return null;
  const absoluteCostBasis = decimalCompare(costBasis, "0") < 0
    ? costBasis.slice(1)
    : costBasis;
  const profit = decimalMultiply(
    decimalSubtract(holding.currentPrice.amount, holding.costPrice),
    holding.quantity,
  );
  return {
    amount: profit,
    percent: decimalToFixed(
      decimalDivide(decimalMultiply(profit, "100"), absoluteCostBasis, 8),
      2,
    ),
  };
}

export function holdingTodayProfit(holding: AssetHolding): {
  amount: string;
  percent: string;
} | null {
  if (
    holding.currentPrice === null ||
    holding.previousClose === null ||
    holding.previousClose === undefined ||
    holding.currentPrice.currency !== holding.previousClose.currency ||
    holding.currentPrice.currency !== holding.currency
  ) {
    return null;
  }
  if (decimalCompare(holding.previousClose.amount, "0") === 0) return null;
  const amount = decimalMultiply(
    decimalSubtract(holding.currentPrice.amount, holding.previousClose.amount),
    holding.quantity,
  );
  return {
    amount,
    percent: decimalToFixed(
      decimalDivide(
        decimalMultiply(
          decimalSubtract(holding.currentPrice.amount, holding.previousClose.amount),
          "100",
        ),
        holding.previousClose.amount,
        8,
      ),
      2,
    ),
  };
}

function hasLegacyLongbridgeQuote(holding: AssetHolding): boolean {
  return holding.valuation.status === "valued" &&
    (
      holding.valuation.priceSource === "Longbridge 行情" ||
      holding.valuation.priceSource === "Longbridge 实时行情"
    );
}

export function holdingQuoteSessionText(
  holding: AssetHolding,
  includeQuoteTime = true,
): string | null {
  if (holding.currentPrice === null) return null;
  const evidence = holding.quoteEvidence;
  const legacyLongbridgeQuote = hasLegacyLongbridgeQuote(holding);
  if (holding.assetClass !== "crypto" && evidence === undefined && !legacyLongbridgeQuote) {
    return null;
  }
  const session = holding.assetClass === "crypto"
    ? "crypto-24h"
    : evidence?.session ?? "unknown";
  const sessionLabel = {
    regular: "常规盘",
    "pre-market": "盘前",
    "post-market": "盘后",
    overnight: "夜盘",
    unknown: "时段未知",
    "crypto-24h": "24h",
  }[session];
  // 旧证券快照没有独立的供应商时间证据，不能把 valuation.pricedAt
  // （它可能是当时的同步时间）冒充为行情时间。加密资产维持来源报价时间。
  const quotedAt = evidence?.quotedAt ??
    (holding.assetClass === "crypto" && holding.valuation.status === "valued"
      ? holding.valuation.pricedAt
      : null);
  return [
    evidence?.freshness === "retained" ? "保留行情" : null,
    evidence?.delivery === "delayed" ? "延迟行情" : null,
    sessionLabel,
    includeQuoteTime
      ? quotedAt === null
        ? "时间不可用"
        : `行情 ${formatShanghaiDateTime(quotedAt)}`
      : null,
  ].filter(Boolean).join(" · ");
}

export function holdingValuationDetail(holding: AssetHolding): string {
  if (holding.valuation.status !== "valued") return holding.valuation.reason;
  const quotedAt = holding.quoteEvidence === undefined
    ? hasLegacyLongbridgeQuote(holding)
      ? null
      : holding.valuation.pricedAt
    : holding.quoteEvidence.quotedAt;
  return `${holding.valuation.priceSource} · ${
    quotedAt === null ? "时间不可用" : formatShanghaiDateTime(quotedAt)
  }`;
}
