import type { DatabaseSync } from "node:sqlite";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import type { SqliteRow } from "./contracts";
import type { SourceAuthorizationResult, SourceConnectionKind } from "./source-record";
import { buildConnectedSource, connectedSourceKind } from "./source-record";
import type { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import type { SqliteAssetSourceStore } from "./sqlite-asset-source-store";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";
import type { SqliteObservationStore } from "./sqlite-observation-store";
import type { AssetSourceSummary } from "@/server/ports";

/** 来源连接、重连、断开与删除写入模块；事务边界由调用方持有。 */
export class SqliteAssetSourceConnectionStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sources: SqliteAssetSourceStore,
    private readonly readModel: SqliteDashboardReadModel,
    private readonly observations: SqliteObservationStore,
    private readonly cards: SqliteAssetCardStore,
  ) {}

  connect(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): void {
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
    this.sources.insert(connected.source, sourcePosition);
    this.cards.append(connected.card);
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

  reconnect(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
  ): string | null {
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
    this.sources.update(updated);
    return source.credentialReference;
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
    this.cards.deleteForSource(sourceId);
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
    this.compactSourcePositions();
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
}
