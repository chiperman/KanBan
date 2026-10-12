import type { DatabaseSync } from "node:sqlite";
import type { ManualAssetRecord, ManualAssetRecordInput } from "@/server/ports";

/** 手工资产原始记录写入模块；来源校验、快照派生与事务边界由调用方持有。 */
export class SqliteManualAssetRecordStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(record: ManualAssetRecord): void {
    this.database
      .prepare(`
        INSERT INTO manual_asset_records (
          source_id, day, amount, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        record.sourceId,
        record.day,
        record.amount,
        record.currency,
        record.recordedAt,
      );
  }

  upsert(
    sourceId: string,
    input: ManualAssetRecordInput,
    recordedAt: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO manual_asset_records (
          source_id, day, amount, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_id, day) DO UPDATE SET
          amount = excluded.amount,
          currency = excluded.currency,
          recorded_at = excluded.recorded_at
      `)
      .run(sourceId, input.day, input.amount, input.currency, recordedAt);
  }

  delete(sourceId: string, day: string): boolean {
    return this.database
      .prepare(
        "DELETE FROM manual_asset_records WHERE source_id = ? AND day = ?",
      )
      .run(sourceId, day).changes > 0;
  }
}
