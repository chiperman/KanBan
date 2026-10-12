import type { DatabaseSync } from "node:sqlite";
import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError, type SourceInvestmentRecord, type SourceInvestmentRecordInput } from "@/domain/source-investment-records";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";

/** 来源投资账本与导入历史共用原连接；调用方持有事务与输入解析。 */
export class SqliteSourceInvestmentStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readModel: SqliteDashboardReadModel,
  ) {}

  insertRecord(record: SourceInvestmentRecord): void {
    this.database.prepare("INSERT INTO source_investment_records (id, source_id, day, kind, amount, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.sourceId, record.day, record.kind, record.amount, record.currency, record.recordedAt);
  }

  saveRecord(sourceId: string, record: SourceInvestmentRecordInput, capturedAt: string): void {
    if (!this.database.prepare("SELECT id FROM asset_sources WHERE id = ?").get(sourceId)) throw new InvalidSourceInvestmentRecordError("资产来源不存在");
    const existing = this.readModel.listSourceInvestmentRecordsSync(sourceId);
    const other = this.database.prepare("SELECT source_id FROM source_investment_records WHERE id = ?").get(record.id) as { source_id: string } | undefined;
    if (other && other.source_id !== sourceId) throw new InvalidSourceInvestmentRecordError("记录 ID 属于其他来源");
    const unchanged = existing.find(row => row.id === record.id);
    if (unchanged && ["day", "kind", "amount", "currency"].every(key => unchanged[key as keyof SourceInvestmentRecord] === record[key as keyof SourceInvestmentRecordInput])) return;
    const remaining = existing.filter(row => row.id !== record.id);
    const historyRow = this.database.prepare("SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?").get(sourceId) as { payload_json: string } | undefined;
    const history = historyRow ? parseSourceInvestmentHistory(JSON.parse(historyRow.payload_json)) : null;
    if (history && record.currency !== history.currency) throw new InvalidSourceInvestmentRecordError("来源投资记录币种与导入历史不一致");
    if (history && record.day < history.openingInvestment.day) throw new InvalidSourceInvestmentRecordError("记录不能早于导入历史期初日期");
    if (remaining.some(row => row.currency !== record.currency)) throw new InvalidSourceInvestmentRecordError("同一来源投资记录币种必须一致");
    if (record.kind === "opening") {
      if (history) throw new InvalidSourceInvestmentRecordError("已有导入历史，不能新增期初本金");
      if (remaining.some(row => row.kind === "opening" || row.day < record.day)) throw new InvalidSourceInvestmentRecordError("期初本金必须唯一且不晚于其他记录");
    } else if (remaining.some(row => row.kind === "opening" && row.day > record.day)) {
      throw new InvalidSourceInvestmentRecordError("记录不能早于期初本金");
    }
    if (record.kind === "valuation" && remaining.some(row => row.kind === "valuation" && row.day === record.day)) throw new InvalidSourceInvestmentRecordError("同日资产金额只能记录一次");
    this.database.prepare("INSERT INTO source_investment_records (id, source_id, day, kind, amount, currency, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, kind = excluded.kind, amount = excluded.amount, currency = excluded.currency, recorded_at = excluded.recorded_at")
      .run(record.id, sourceId, record.day, record.kind, record.amount, record.currency, capturedAt);
  }

  deleteRecord(sourceId: string, id: string): void {
    if (!this.database.prepare("SELECT id FROM asset_sources WHERE id = ?").get(sourceId)) throw new InvalidSourceInvestmentRecordError("资产来源不存在");
    const result = this.database.prepare("DELETE FROM source_investment_records WHERE source_id = ? AND id = ?").run(sourceId, id);
    if (!result.changes) throw new InvalidSourceInvestmentRecordError("来源投资记录不存在");
  }

  writeHistory(history: SourceInvestmentHistory): void {
    this.database.prepare("INSERT INTO asset_source_investment_histories (source_id, payload_json) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET payload_json = excluded.payload_json")
      .run(history.sourceId, JSON.stringify(history));
  }

  importHistory(history: SourceInvestmentHistory): { imported: boolean; records: number } {
    const source = this.database.prepare("SELECT kind, label FROM asset_sources WHERE id = ?").get(history.sourceId) as { kind: string; label: string } | undefined;
    if (!source || (source.kind !== "manual" && source.kind !== "longbridge") || source.label !== history.sourceLabel) throw new Error("导入目标来源身份不匹配");
    const local = this.readModel.listSourceInvestmentRecordsSync(history.sourceId);
    if (local.some(record => record.kind === "opening" || record.currency !== history.currency || record.day < history.openingInvestment.day)) throw new Error("导入历史与已有手工记录期初、币种或日期冲突");
    const row = this.database.prepare("SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?").get(history.sourceId) as { payload_json: string } | undefined;
    if (row) {
      const old = parseSourceInvestmentHistory(JSON.parse(row.payload_json));
      if (old.accountId !== history.accountId || old.provider !== history.provider || old.currency !== history.currency ||
          JSON.stringify(old.openingInvestment) !== JSON.stringify(history.openingInvestment)) throw new Error("导入账户与已有历史不一致");
      const incoming = new Map(history.records.map(record => [record.id, record]));
      if (old.records.some(record => JSON.stringify(record) !== JSON.stringify(incoming.get(record.id)))) throw new Error("导入包含历史覆盖或删除冲突");
      if (old.records.length === history.records.length) return { imported: false, records: old.records.length };
    }
    this.writeHistory(history);
    return { imported: true, records: history.records.length };
  }
}
