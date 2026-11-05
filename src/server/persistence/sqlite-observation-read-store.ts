import { migrateDailyObservation } from "@/server/persistence/migrations";
import type { SqliteRow } from "@/server/persistence/contracts";
import type { DailyAssetSnapshot, DailyAssetTrendObservation, ImportedAssetSourceHistoryObservation } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

type DailyObservationTable = "daily_asset_snapshots" | "daily_asset_trend_observations";
type DailySourceTable = "daily_asset_source_snapshots" | "daily_asset_source_trend_observations";

/** SQLite 每日观测查询与行解码；不承担写入或事务。 */
export class SqliteObservationReadStore {
  constructor(private readonly database: DatabaseSync) {}

  dailySourceRows(day: string, table: DailySourceTable = "daily_asset_source_snapshots"): SqliteRow[] {
    return this.database.prepare(`
      SELECT source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      FROM ${table}
      WHERE day = ?
      ORDER BY rowid
    `).all(day) as SqliteRow[];
  }

  listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    return this.listDailyObservationsSync("daily_asset_snapshots", "daily_asset_source_snapshots");
  }

  listDailyAssetTrendObservationsSync(): DailyAssetTrendObservation[] {
    return this.listDailyObservationsSync("daily_asset_trend_observations", "daily_asset_source_trend_observations");
  }

  listImportedSourceHistoryObservationsSync(): ImportedAssetSourceHistoryObservation[] {
    const rows = this.database.prepare(`
      SELECT * FROM imported_asset_source_history_observations
      ORDER BY day, source_id
    `).all() as SqliteRow[];
    return rows.map((row) => ({
      day: row.day as string,
      sourceId: row.source_id as string,
      label: row.label as string,
      kind: row.kind as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as ImportedAssetSourceHistoryObservation["status"],
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
    }));
  }

  firstSourceObservationDay(sourceId: string): string | undefined {
    const row = this.database.prepare(
      "SELECT MIN(day) AS day FROM daily_asset_source_trend_observations WHERE source_id = ?",
    ).get(sourceId) as SqliteRow | undefined;
    return typeof row?.day === "string" ? row.day : undefined;
  }

  listDailyObservationsSync(
    snapshotTable: DailyObservationTable,
    sourceTable: DailySourceTable,
    day?: string,
    query?: { sourceId: string; from?: string; to?: string },
  ): DailyAssetSnapshot[] {
    const conditions: string[] = [];
    const args: string[] = [];
    if (day !== undefined) { conditions.push("day = ?"); args.push(day); }
    if (query?.from) { conditions.push("day >= ?"); args.push(query.from); }
    if (query?.to) { conditions.push("day <= ?"); args.push(query.to); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const rows = this.database.prepare("SELECT * FROM " + snapshotTable + where + " ORDER BY day").all(...args) as SqliteRow[];
    const sourceWhere = query ? (where ? where + " AND " : " WHERE ") + "source_id = ?" : where;
    const children = this.database.prepare("SELECT * FROM " + sourceTable + sourceWhere + " ORDER BY day, source_id")
      .all(...args, ...(query ? [query.sourceId] : [])) as SqliteRow[];
    const byDay = new Map<string, SqliteRow[]>();
    for (const child of children) {
      const items = byDay.get(child.day as string) ?? [];
      items.push(child); byDay.set(child.day as string, items);
    }
    return rows.map((row) => migrateDailyObservation({
      day: row.day as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as "complete" | "incomplete" | "expired",
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
      exchangeRates: JSON.parse((row.exchange_rates_json as string | null) ?? "[]"),
      ...(typeof row.source_scope_json === "string"
        ? { sourceScope: JSON.parse(row.source_scope_json) as string[] } : {}),
      sources: (byDay.get(row.day as string) ?? []).map((source) => ({
        sourceId: source.source_id as string,
        label: source.label as string,
        kind: source.kind as string,
        capturedAt: source.captured_at as string,
        complete: source.complete === 1,
        status: source.status as "complete" | "incomplete" | "expired",
        total: {
          USD: source.total_usd as string | null,
          CNY: source.total_cny as string | null,
          HKD: source.total_hkd as string | null,
        },
        ...(source.asset_class_totals_json === null ? {} : {
          assetClassTotals: JSON.parse(source.asset_class_totals_json as string),
        }),
      })),
    }));
  }
}
