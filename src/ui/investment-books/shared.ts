import type { AssetSourceSummary } from "@/server/ports";
import { formatAssetAmount } from "@/ui/asset-price-display";

export type InvestmentBookSource = Omit<AssetSourceSummary, "credentialReference" | "permissions">;
export const labels = {
  opening: "期初本金",
  deposit: "入金",
  withdrawal: "出金",
  valuation: "资产金额",
};
export function bookMoney(value: string): string {
  return formatAssetAmount(value);
}
