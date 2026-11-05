import type { ManualAssetClass } from "@/domain/assets";

export type InvestmentBookId = "us-stocks" | "a-shares" | "crypto";

export interface SourceBookIdentity {
  kind: string;
  manualAssetClass?: ManualAssetClass;
  investmentBookId?: InvestmentBookId | null;
}

export function isInvestmentBookId(value: unknown): value is InvestmentBookId {
  return value === "us-stocks" || value === "a-shares" || value === "crypto";
}

/** 仅兼容旧来源；未知插件绝不默认归入虚拟货币账本。 */
export function sourceInvestmentBookId(source: SourceBookIdentity): InvestmentBookId | null {
  if (source.kind === "manual") {
    return source.manualAssetClass === "securities" ? "a-shares" :
      source.manualAssetClass === "crypto" ? "crypto" : null;
  }
  if (source.investmentBookId !== undefined) return source.investmentBookId;
  if (source.kind === "longbridge") return "us-stocks";
  return ["binance", "okx", "bitget", "bit", "evm-watch-ethereum", "evm-watch-bsc"].includes(source.kind)
    ? "crypto" : null;
}

export function normalizedSourceBookId(source: SourceBookIdentity): InvestmentBookId | null {
  if (source.investmentBookId !== undefined && source.investmentBookId !== null &&
      !isInvestmentBookId(source.investmentBookId)) throw new Error("来源账本归属无效");
  const bookId = sourceInvestmentBookId(source);
  if (source.kind === "manual" && source.investmentBookId !== undefined &&
      source.investmentBookId !== bookId) throw new Error("手工来源账本与资产类别不一致");
  return bookId;
}
