import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { assertManualAssetRecordNotFuture } from "@/domain/manual-asset-records";
import { applyLatestManualAssetRecord, latestManualAssetRecord } from "./observations";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";
import type { SqliteObservationStore } from "./sqlite-observation-store";
import type { AssetSourceSummary, CreateManualAssetSourceInput, ManualAssetRecordInput } from "@/server/ports";
import type { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import type { SqliteManualAssetRecordStore } from "./sqlite-manual-asset-record-store";
import type { SqliteAssetSourceDataStore } from "./sqlite-asset-source-data-store";

/** 手工来源与记录派生写入模块；跨表事务由调用方统一控制。 */
export class SqliteManualAssetSourceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readModel: SqliteDashboardReadModel,
    private readonly observations: SqliteObservationStore,
    private readonly cards: SqliteAssetCardStore,
    private readonly manualRecords: SqliteManualAssetRecordStore,
    private readonly data: SqliteAssetSourceDataStore,
  ) {}

  createManual(input: CreateManualAssetSourceInput, capturedAt: string): void {
    const sourceId = randomUUID();
    const source: AssetSourceSummary = {
      id: sourceId,
      kind: "manual",
      label: input.label,
      hasManualRecord: false,
      accountId: `manual:${sourceId}`,
      permissions: [],
      credentialReference: null,
      snapshot: {
        total: { amount: "0", currency: "CNY" },
        holdings: [],
        exchangeRates: [],
        syncedAt: capturedAt,
      },
      sync: {
        status: "current",
        lastSuccessfulAt: capturedAt,
        lastAttemptAt: capturedAt,
        error: null,
      },
    };
    this.data.insert(source, this.data.count());
    this.cards.append(
      {
        id: randomUUID(),
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      },
    );
  }

  recordManual(sourceId: string, input: ManualAssetRecordInput, capturedAt: string): void {
    assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
    const source = this.readModel.listSourcesSync(sourceId).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产记录可以编辑今日总额");
    }
    this.manualRecords.upsert(sourceId, input, capturedAt);
    const record = this.readModel.listManualAssetRecordsSync(sourceId).find(
      (item) => item.day === input.day,
    );
    if (!record) throw new Error("手工资产记录保存失败");
    const latest = latestManualAssetRecord(
      this.readModel.listManualAssetRecordsSync(sourceId),
    );
    const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
    this.data.writeDetails(updated);
    this.observations.recordManual(updated, record, capturedAt);
  }

  deleteManualRecord(sourceId: string, day: string, capturedAt: string): void {
    const source = this.readModel.listSourcesSync(sourceId).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产记录可以删除");
    }
    if (!this.manualRecords.delete(sourceId, day)) {
      throw new Error("指定日期没有手工资产记录");
    }
    const latest = latestManualAssetRecord(
      this.readModel.listManualAssetRecordsSync(sourceId),
    );
    this.data.writeDetails(
      applyLatestManualAssetRecord(source, latest, capturedAt),
    );
    this.database
      .prepare("DELETE FROM daily_asset_source_trend_observations WHERE day = ? AND source_id = ?")
      .run(day, sourceId);
    this.observations.recalculateTrend(day);
  }
}
