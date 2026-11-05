import type { InvestmentCashflowKind, InvestmentCashflowCurrency, InvestmentCashflowInput, InvestmentCashflow, InvestmentCashflowUpdate } from "@/domain/investment-cashflows";
export type { InvestmentCashflowKind, InvestmentCashflowCurrency, InvestmentCashflowInput, InvestmentCashflow, InvestmentCashflowUpdate } from "@/domain/investment-cashflows";

export interface InvestmentCashflows {
  list(): Promise<InvestmentCashflow[]>;
  create(input: InvestmentCashflowInput): Promise<InvestmentCashflow>;
  update(
    id: string,
    input: InvestmentCashflowUpdate,
  ): Promise<InvestmentCashflow>;
  delete(id: string): Promise<void>;
}
