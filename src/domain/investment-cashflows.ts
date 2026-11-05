import type { AssetExchangeRate } from "@/domain/assets";

export type InvestmentCashflowKind =
  | "initial-investment"
  | "external-deposit"
  | "external-withdrawal";

export type InvestmentCashflowCurrency = "USD" | "CNY" | "HKD";

export interface InvestmentCashflowInput {
  kind: InvestmentCashflowKind;
  /** 资金实际跨越投资范围的 ISO 时间；历史补录不得伪造资产观测。 */
  occurredAt: string;
  amount: string;
  currency: InvestmentCashflowCurrency;
  note: string | null;
}

/**
 * 单所有者组合的本金事实。amounts 仅保存创建或金额相关编辑时可取得的长桥参考汇率换算值；
 * 无可靠长桥观察时对应币种为 null，绝不回退到其他来源或固定汇率。
 */
export interface InvestmentCashflow extends InvestmentCashflowInput {
  id: string;
  amounts: Record<InvestmentCashflowCurrency, string | null>;
  exchangeRates: AssetExchangeRate[];
  createdAt: string;
  updatedAt: string;
}

export type InvestmentCashflowUpdate = Partial<InvestmentCashflowInput>;
