import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { SqliteRow } from "@/server/persistence/contracts";
import type { InvestmentCashflow } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

/** SQLite 资金与来源投资历史查询；不承担写入或事务。 */
export class SqliteInvestmentReadStore {
  constructor(private readonly database: DatabaseSync) {}

  listInvestmentCashflowsSync(): InvestmentCashflow[] {
    const rows = this.database.prepare(`
      SELECT * FROM investment_cashflows
      ORDER BY occurred_at DESC, created_at DESC, id DESC
    `).all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as InvestmentCashflow["kind"],
      occurredAt: row.occurred_at as string,
      amount: row.amount as string,
      currency: row.currency as InvestmentCashflow["currency"],
      note: row.note as string | null,
      amounts: {
        USD: row.amount_usd as string | null,
        CNY: row.amount_cny as string | null,
        HKD: row.amount_hkd as string | null,
      },
      exchangeRates: JSON.parse(row.exchange_rates_json as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  listSourceInvestmentRecordsSync(sourceId?: string): SourceInvestmentRecord[] {
    const rows = this.database.prepare("SELECT id, source_id, day, kind, amount, currency, recorded_at FROM source_investment_records " +
      (sourceId === undefined ? "" : "WHERE source_id = ? ") + "ORDER BY source_id, day, id")
      .all(...(sourceId === undefined ? [] : [sourceId])) as SqliteRow[];
    return rows.map(row => ({ id: row.id as string, sourceId: row.source_id as string,
      day: row.day as string, kind: row.kind as SourceInvestmentRecord["kind"],
      amount: row.amount as string, currency: row.currency as SourceInvestmentRecord["currency"],
      recordedAt: row.recorded_at as string }));
  }

  getSourceInvestmentHistory(sourceId: string): SourceInvestmentHistory | null {
    const row = this.database.prepare(
      "SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?",
    ).get(sourceId) as { payload_json: string } | undefined;
    return row ? parseSourceInvestmentHistory(JSON.parse(row.payload_json)) : null;
  }

  listSourceInvestmentHistories(): SourceInvestmentHistory[] {
    return (this.database.prepare("SELECT payload_json FROM asset_source_investment_histories ORDER BY source_id").all() as { payload_json: string }[])
      .map(row => parseSourceInvestmentHistory(JSON.parse(row.payload_json)));
  }
}
