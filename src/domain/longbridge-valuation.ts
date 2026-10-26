import { decimalAdd, decimalCompare } from "@/domain/decimal";
import { isLongbridgeUsOptionSymbol } from "@/domain/longbridge-symbols";
import type { AssetSnapshot } from "@/domain/assets";

/** 当前总资产采用完整的最新行情（含盘外）加官方现金；缺项时回退账户原值。 */
export function revalueLongbridgeSnapshot(snapshot: AssetSnapshot): AssetSnapshot {
  const evidence = snapshot.longbridgeValuation ?? {
    basis: "reported" as const,
    reportedTotal: snapshot.total,
    reportedAt: null,
  };
  const currency = evidence.reportedTotal.currency;
  const cash = snapshot.holdings.filter((holding) => holding.assetClass === "cash");
  const complete = cash.length === 1 && cash[0].symbol === `CASH.${currency}` &&
    snapshot.holdings.every((holding) => {
      if (decimalCompare(holding.quantity, "0") === 0) return true;
      if (holding.valuation.status !== "valued" ||
          holding.sourceMarketValue?.currency !== currency) return false;
      if (holding.assetClass === "cash") return true;
      if (isLongbridgeUsOptionSymbol(holding.symbol) || holding.currentPrice === null) return false;
      return (holding.quoteEvidence?.freshness === "current" &&
        holding.quoteEvidence.quotedAt !== null) ||
        holding.valuation.priceSource === "Longbridge 基金净值";
    });
  const amount = complete
    ? snapshot.holdings.reduce((sum, holding) => decimalAdd(
        sum,
        decimalCompare(holding.quantity, "0") === 0 ? "0" : holding.sourceMarketValue!.amount,
      ), "0")
    : evidence.reportedTotal.amount;
  return {
    ...snapshot,
    total: { amount, currency },
    longbridgeValuation: { ...evidence, basis: complete ? "latest-quotes" : "reported" },
  };
}
