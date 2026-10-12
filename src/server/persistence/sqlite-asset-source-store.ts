import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buildDailyAssetSnapshot, shanghaiDay } from "@/domain/daily-asset-snapshots";
import { assertManualAssetRecordNotFuture } from "@/domain/manual-asset-records";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import type { SqliteRow } from "./contracts";
import { applyLatestManualAssetRecord, latestManualAssetRecord } from "./observations";
import type { SourceAuthorizationResult, SourceConnectionKind } from "./source-record";
import { buildConnectedSource, connectedSourceKind } from "./source-record";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";
import type { SqliteObservationStore } from "./sqlite-observation-store";
import type { AssetSourceSummary, Card, CreateManualAssetSourceInput, ManualAssetClass, ManualAssetRecordInput } from "@/server/ports";

/** 来源身份、快照与关联卡片写入共用原连接；跨表事务由拥有者统一控制。 */
export class SqliteAssetSourceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readModel: SqliteDashboardReadModel,
    private readonly observations: SqliteObservationStore,
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

  insertCard(card: Card, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_cards (
          id, position, title, body, source_id, hidden, span, starts_new_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        card.id,
        position,
        card.title,
        card.body,
        card.sourceId ?? null,
        card.hidden === undefined ? null : Number(card.hidden),
        card.span,
        card.startsNewRow === undefined ? null : Number(card.startsNewRow),
      );
  }

  private compactPositions(table: "asset_sources" | "asset_cards"): void {
    const rows = this.database
      .prepare(`SELECT id, position FROM ${table} ORDER BY position`)
      .all() as SqliteRow[];
    const update = this.database.prepare(
      `UPDATE ${table} SET position = ? WHERE id = ?`,
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

  setCardHidden(sourceId: string, hidden: boolean): void {
    if (
      this.database
        .prepare("SELECT id FROM asset_sources WHERE id = ?")
        .get(sourceId) === undefined
    ) {
      throw new Error("资产来源不存在");
    }
    const result = this.database
      .prepare("UPDATE asset_cards SET hidden = ? WHERE source_id = ?")
      .run(Number(hidden), sourceId);
    if (result.changes === 0) throw new Error("资产卡片不存在");
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
    const cardPosition = (
      this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
    ).count as number;
    this.insert(source, sourcePosition);
    this.insertCard(
      {
        id: randomUUID(),
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      },
      cardPosition,
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
      .run(sourceId, input.day, input.amount, input.currency, capturedAt);
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
    const result = this.database
      .prepare(
        "DELETE FROM manual_asset_records WHERE source_id = ? AND day = ?",
      )
      .run(sourceId, day);
    if (result.changes === 0) throw new Error("指定日期没有手工资产记录");
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

  disconnect(sourceId: string): string | null {
    const source = this.database
      .prepare(
        "SELECT kind, credential_reference FROM asset_sources WHERE id = ?",
      )
      .get(sourceId) as SqliteRow | undefined;
    if (source === undefined) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    this.database
      .prepare("UPDATE asset_sources SET lifecycle = 'disconnected' WHERE id = ?")
      .run(sourceId);
    return typeof source.credential_reference === "string"
      ? source.credential_reference
      : null;
  }

  delete(sourceId: string): string | null {
    const source = this.database
      .prepare(
        "SELECT credential_reference FROM asset_sources WHERE id = ?",
      )
      .get(sourceId) as SqliteRow | undefined;
    if (source === undefined) throw new Error("资产来源不存在");
    const baselineDays = this.database
      .prepare(
        "SELECT day FROM daily_asset_source_snapshots WHERE source_id = ?",
      )
      .all(sourceId) as SqliteRow[];
    const trendDays = this.database
      .prepare(
        "SELECT day FROM daily_asset_source_trend_observations WHERE source_id = ?",
      )
      .all(sourceId) as SqliteRow[];
    this.database
      .prepare(`
        DELETE FROM formal_daily_settlements
        WHERE anchor_key IN (
          SELECT anchor_key
          FROM formal_daily_settlement_sources
          WHERE source_id = ?
        )
      `)
      .run(sourceId);
    this.database
      .prepare("DELETE FROM asset_cards WHERE source_id = ?")
      .run(sourceId);
    this.database
      .prepare("DELETE FROM daily_asset_source_snapshots WHERE source_id = ?")
      .run(sourceId);
    this.database
      .prepare("DELETE FROM daily_asset_source_trend_observations WHERE source_id = ?")
      .run(sourceId);
    this.database
      .prepare("DELETE FROM imported_asset_source_history_observations WHERE source_id = ?")
      .run(sourceId);
    this.database.prepare("DELETE FROM asset_sources WHERE id = ?").run(sourceId);
    this.compactPositions("asset_sources");
    this.compactPositions("asset_cards");
    for (const { day } of baselineDays) {
      this.observations.recalculate(day as string, {
        snapshot: "daily_asset_snapshots",
        source: "daily_asset_source_snapshots",
      });
    }
    for (const { day } of trendDays) this.observations.recalculateTrend(day as string);
    return typeof source.credential_reference === "string"
      ? source.credential_reference
      : null;
  }

  reconnect(sourceId: string, sourceKind: SourceConnectionKind, result: SourceAuthorizationResult, credentialReference: string, capturedAt: string): string | null {
    const source = this.readModel.listSourcesSync().find(({ id }) => id === sourceId);
    const kind = connectedSourceKind(sourceKind, result);
    if (!source || source.kind !== kind) {
      throw new Error("资产来源不存在或类型不匹配");
    }
    if (source.accountId !== result.account.id) {
      throw new Error("新授权对应的账户与原来源不一致");
    }
    const updated: AssetSourceSummary = {
      ...source,
      label: result.account.label,
      accountId: result.account.id,
      permissions: result.permissions,
      credentialReference,
      snapshot: result.snapshot,
      lifecycle: "connected",
      sync: {
        status: "current",
        lastSuccessfulAt: result.snapshot.syncedAt,
        lastAttemptAt: result.snapshot.syncedAt,
        error: null,
      },
    };
    this.database
      .prepare(`
        UPDATE asset_sources
        SET label = ?, account_id = ?, permissions_json = ?,
            credential_reference = ?, lifecycle = ?
        WHERE id = ?
      `)
      .run(
        updated.label,
        updated.accountId,
        JSON.stringify(updated.permissions),
        updated.credentialReference,
        "connected",
        updated.id,
    );
    this.upsertDetails(updated);
    return source.credentialReference;
  }

  connect(sourceKind: SourceConnectionKind, result: SourceAuthorizationResult, credentialReference: string, capturedAt: string): void {
    const isFirstAutomaticSource = this.database
      .prepare("SELECT 1 FROM asset_sources WHERE kind <> 'manual' LIMIT 1")
      .get() === undefined;
    const connected = buildConnectedSource(
      sourceKind,
      result,
      credentialReference,
    );
    const sourcePosition = (
      this.database.prepare("SELECT COUNT(*) AS count FROM asset_sources").get() as SqliteRow
    ).count as number;
    const cardPosition = (
      this.database.prepare("SELECT COUNT(*) AS count FROM asset_cards").get() as SqliteRow
    ).count as number;
    this.insert(connected.source, sourcePosition);
    this.insertCard(connected.card, cardPosition);
    const observation = buildDailyAssetSnapshot(
      this.readModel.listSourcesSync(),
      capturedAt,
    );
    if (isFirstAutomaticSource && observation.complete) {
      const hasBaseline = this.database
        .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
        .get(observation.day) !== undefined;
      if (!hasBaseline) this.observations.insertBaseline(observation);
      this.observations.upsertTrend(observation);
    }
  }
}
