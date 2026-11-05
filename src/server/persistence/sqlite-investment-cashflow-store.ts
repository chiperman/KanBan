import type { DatabaseSync } from "node:sqlite";
import type { InvestmentCashflow } from "@/server/ports";

/** 组合资金进出账本的 SQLite 写入模块；事务边界由调用方持有。 */
export class SqliteInvestmentCashflowStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(cashflow: InvestmentCashflow): void {
    this.database
      .prepare(`
        INSERT INTO investment_cashflows (
          id, kind, occurred_at, amount, currency, note,
          amount_usd, amount_cny, amount_hkd, exchange_rates_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        cashflow.id,
        cashflow.kind,
        cashflow.occurredAt,
        cashflow.amount,
        cashflow.currency,
        cashflow.note,
        cashflow.amounts.USD,
        cashflow.amounts.CNY,
        cashflow.amounts.HKD,
        JSON.stringify(cashflow.exchangeRates),
        cashflow.createdAt,
        cashflow.updatedAt,
      );
  }

  update(cashflow: InvestmentCashflow): void {
    const result = this.database
      .prepare(`
        UPDATE investment_cashflows
        SET kind = ?, occurred_at = ?, amount = ?, currency = ?, note = ?,
            amount_usd = ?, amount_cny = ?, amount_hkd = ?,
            exchange_rates_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        cashflow.kind,
        cashflow.occurredAt,
        cashflow.amount,
        cashflow.currency,
        cashflow.note,
        cashflow.amounts.USD,
        cashflow.amounts.CNY,
        cashflow.amounts.HKD,
        JSON.stringify(cashflow.exchangeRates),
        cashflow.updatedAt,
        cashflow.id,
      );
    if (result.changes !== 1) throw new Error("资金记录不存在");
  }

  delete(id: string): void {
    const result = this.database
      .prepare("DELETE FROM investment_cashflows WHERE id = ?")
      .run(id);
    if (result.changes !== 1) throw new Error("资金记录不存在");
  }
}
