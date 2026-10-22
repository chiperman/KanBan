import type { BookRecord } from "@/domain/investment-books";
import { decimalCompare } from "@/domain/decimal";
import { formatAssetAmount } from "@/ui/asset-price-display";
import { AssetFinancialValue } from "@/ui/asset-financial-value";

/** 读取已存结单的原币备注，仅用于展示，账本金额仍是原有 USD 本金。 */
export function longbridgeOriginalFundingAmount(record: BookRecord) {
  if (record.origin !== "statement" || record.bookId !== "us-stocks" || record.currency !== "USD" ||
      (record.kind !== "deposit" && record.kind !== "withdrawal")) return null;
  const match = /^(?:长桥原币|长桥结单；原币) HKD (-?\d+(?:\.\d+)?)；/.exec(record.note);
  if (!match || decimalCompare(match[1], "0") !== (record.kind === "deposit" ? 1 : -1)) return null;
  return { amount: match[1].replace(/^-/, ""), currency: "HKD" as const };
}

export function InvestmentBookRecordAmount({ amount, currency, record }: {
  amount: string | null;
  currency: string;
  record?: BookRecord;
}) {
  if (amount === null) return <>数据不足</>;
  const original = record ? longbridgeOriginalFundingAmount(record) : null;
  return <>
    <AssetFinancialValue unit={original?.currency ?? currency}>{formatAssetAmount(original?.amount ?? amount)}</AssetFinancialValue>
    {original ? <small className="investment-books__basis">折合 <AssetFinancialValue unit={currency}>{formatAssetAmount(amount)}</AssetFinancialValue></small> : null}
  </>;
}
