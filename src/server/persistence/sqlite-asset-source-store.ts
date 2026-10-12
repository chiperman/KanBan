import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { assertManualAssetRecordNotFuture } from "@/domain/manual-asset-records";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import type { SqliteRow } from "./contracts";
import { applyLatestManualAssetRecord, latestManualAssetRecord } from "./observations";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";
import type { SqliteObservationStore } from "./sqlite-observation-store";
import type { AssetSourceSummary, CreateManualAssetSourceInput, ManualAssetClass, ManualAssetRecordInput } from "@/server/ports";
import type { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import type { SqliteManualAssetRecordStore } from "./sqlite-manual-asset-record-store";

/** 来源身份与快照写入模块；关联卡片由独立模块写入，跨表事务由拥有者统一控制。 */
export class SqliteAssetSourceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readModel: SqliteDashboardReadModel,
    private readonly observations: SqliteObservationStore,
    private readonly cards: SqliteAssetCardStore,
    private readonly manualRecords: SqliteManualAssetRecordStore,
  ) {}

  insert(source: AssetSourceSummary, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, ignored_asset_keys_json, included_asset_keys_json,
          has_manual_record, manual_asset_class, lifecycle
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        position,
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
      );
    this.upsertDetails(source);
  }

  private upsertDetails(source: AssetSourceSummary): void {
    const sync = normalizeAssetSyncState(source.sync);
    this.database
      .prepare(`
        UPDATE asset_sources
        SET has_manual_record = ?
        WHERE id = ?
      `)
      .run(
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.id,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_snapshots (
          source_id, total_amount, total_currency, holdings_json,
          unrecognized_evm_tokens_json, exchange_rates_json, coverage_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.snapshot.total.amount,
        source.snapshot.total.currency,
        JSON.stringify(source.snapshot.holdings),
        JSON.stringify(source.snapshot.unrecognizedEvmTokens ?? []),
        JSON.stringify(source.snapshot.exchangeRates),
        source.snapshot.coverage === undefined
          ? null
          : JSON.stringify(source.snapshot.coverage),
        source.snapshot.syncedAt,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_sync_states (
          source_id, status, last_successful_at, last_attempt_at, error, failed_mode,
          diagnostic_json, recent_attempts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.sync.status,
        source.sync.lastSuccessfulAt,
        source.sync.lastAttemptAt,
        source.sync.error,
        source.sync.failedMode ?? null,
        sync.diagnostic === undefined || sync.diagnostic === null
          ? null : JSON.stringify(sync.diagnostic),
        JSON.stringify(sync.recentAttempts ?? []),
      );
  }

  private compactSourcePositions(): void {
    const rows = this.database
      .prepare("SELECT id, position FROM asset_sources ORDER BY position")
      .all() as SqliteRow[];
    const update = this.database.prepare(
      "UPDATE asset_sources SET position = ? WHERE id = ?",
    );
    rows.forEach((row, position) => {
      if (row.position !== position) update.run(position, row.id as string);
    });
  }

  update(source: AssetSourceSummary): void {
    const existing = this.database
      .prepare("SELECT id FROM asset_sources WHERE id = ?")
      .get(source.id);
    if (existing === undefined) return;
    this.database
      .prepare(`
        UPDATE asset_sources
        SET kind = ?, label = ?, display_name = ?, account_id = ?,
            permissions_json = ?, credential_reference = ?,
            ignored_asset_keys_json = ?, included_asset_keys_json = ?,
            manual_asset_class = ?, lifecycle = ?
        WHERE id = ?
      `)
      .run(
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
        source.id,
      );
    this.upsertDetails(source);
  }

  setDisplayName(sourceId: string, displayName: string | null): void {
    const result = this.database
      .prepare("UPDATE asset_sources SET display_name = ? WHERE id = ?")
      .run(displayName, sourceId);
    if (result.changes === 0) throw new Error("资产来源不存在");
  }

  setManualClass(sourceId: string, assetClass: ManualAssetClass | null): void {
    const source = this.database
      .prepare("SELECT kind FROM asset_sources WHERE id = ?")
      .get(sourceId) as { kind: string } | undefined;
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产来源可以设置资产类别");
    }
    this.database
      .prepare(
        "UPDATE asset_sources SET manual_asset_class = ? WHERE id = ?",
      )
      .run(assetClass, sourceId);
  }

  setEvmTokenPreferences(sourceId: string, ignoredAssetKeys: string[], includedAssetKeys: string[]): void {
    const result = this.database
      .prepare(
        `UPDATE asset_sources
         SET ignored_asset_keys_json = ?, included_asset_keys_json = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(ignoredAssetKeys),
        JSON.stringify(includedAssetKeys),
        sourceId,
      );
    if (result.changes === 0) throw new Error("资产来源不存在");
  }

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
    const sourcePosition = (
      this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
    ).count as number;
    this.insert(source, sourcePosition);
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
    const source = this.readModel.listSourcesSync().find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产记录可以编辑今日总额");
    }
    this.manualRecords.upsert(sourceId, input, capturedAt);
    const record = this.readModel.listManualAssetRecordsSync().find(
      (item) => item.sourceId === sourceId && item.day === input.day,
    );
    if (!record) throw new Error("手工资产记录保存失败");
    const latest = latestManualAssetRecord(
      this.readModel.listManualAssetRecordsSync().filter(
        (item) => item.sourceId === sourceId,
      ),
    );
    const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
    this.upsertDetails(updated);
    this.observations.recordManual(updated, record, capturedAt);
  }

  deleteManualRecord(sourceId: string, day: string, capturedAt: string): void {
    const source = this.readModel.listSourcesSync().find(
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
      this.readModel.listManualAssetRecordsSync().filter(
        (item) => item.sourceId === sourceId,
      ),
    );
    this.upsertDetails(
      applyLatestManualAssetRecord(source, latest, capturedAt),
    );
    for (const [snapshot, sourceTable] of [
      ["daily_asset_snapshots", "daily_asset_source_snapshots"],
      ["daily_asset_trend_observations", "daily_asset_source_trend_observations"],
    ] as const) {
      this.database
        .prepare(`DELETE FROM ${sourceTable} WHERE day = ? AND source_id = ?`)
        .run(day, sourceId);
      this.observations.recalculate(day, {
        snapshot,
        source: sourceTable,
      });
    }
  }

}
