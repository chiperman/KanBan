import type { DatabaseSync } from "node:sqlite";
import { buildDailyAssetSnapshot, mergeDailyTrendObservation, shanghaiDay } from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { manualDailySource } from "@/server/persistence/observations";
import type { SqliteDashboardReadModel } from "@/server/persistence/sqlite-read-model";
import type { AssetSourceSummary, DailyAssetSnapshot, DailyAssetSourceSnapshot, DailyAssetTrendObservation, ImportedAssetSourceHistoryObservation, ManualAssetRecord } from "@/server/ports";

/** 观测写入共用拥有者的连接；调用方负责事务，不在模块内部开启嵌套事务。 */
export class SqliteObservationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readModel: SqliteDashboardReadModel,
  ) {}

  insertBaseline(snapshot: DailyAssetSnapshot): boolean {
    const inserted = this.database
      .prepare(`
        INSERT OR IGNORE INTO daily_asset_snapshots (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      ).changes > 0;
    if (!inserted) return false;
    this.insertBaselineSources(snapshot);
    return true;
  }

  private insertBaselineSources(snapshot: DailyAssetSnapshot): void {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO daily_asset_source_snapshots (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
  }

  private replaceExpiredBaseline(snapshot: DailyAssetSnapshot): void {
    this.database
      .prepare(`
        UPDATE daily_asset_snapshots
        SET captured_at = ?, complete = ?, status = ?, total_usd = ?, total_cny = ?,
          total_hkd = ?, exchange_rates_json = ?
        WHERE day = ?
      `)
      .run(
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
        snapshot.day,
      );
    this.database
      .prepare("DELETE FROM daily_asset_source_snapshots WHERE day = ?")
      .run(snapshot.day);
    this.insertBaselineSources(snapshot);
  }

  upsertTrend(
    snapshot: DailyAssetTrendObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO daily_asset_trend_observations (
          day, captured_at, complete, status, total_usd, total_cny, total_hkd,
          exchange_rates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          exchange_rates_json = excluded.exchange_rates_json
      `)
      .run(
        snapshot.day,
        snapshot.capturedAt,
        Number(snapshot.complete),
        snapshot.status ?? (snapshot.complete ? "complete" : "incomplete"),
        snapshot.total.USD,
        snapshot.total.CNY,
        snapshot.total.HKD ?? null,
        JSON.stringify(snapshot.exchangeRates ?? []),
      );
    this.database
      .prepare("DELETE FROM daily_asset_source_trend_observations WHERE day = ?")
      .run(snapshot.day);
    const statement = this.database.prepare(`
      INSERT INTO daily_asset_source_trend_observations (
        day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
        total_hkd, asset_class_totals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, source_id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        captured_at = excluded.captured_at,
        complete = excluded.complete,
        status = excluded.status,
        total_usd = excluded.total_usd,
        total_cny = excluded.total_cny,
        total_hkd = excluded.total_hkd,
        asset_class_totals_json = excluded.asset_class_totals_json
    `);
    for (const source of snapshot.sources) {
      statement.run(
        snapshot.day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
    }
    this.recalculateTrend(snapshot.day);
  }

  private upsertSource(
    table:
      | "daily_asset_source_snapshots"
      | "daily_asset_source_trend_observations",
    day: string,
    source: DailyAssetSourceSnapshot,
  ): void {
    this.database
      .prepare(`
        INSERT INTO ${table} (
          day, source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, source_id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          captured_at = excluded.captured_at,
          complete = excluded.complete,
          status = excluded.status,
          total_usd = excluded.total_usd,
          total_cny = excluded.total_cny,
          total_hkd = excluded.total_hkd,
          asset_class_totals_json = excluded.asset_class_totals_json
      `)
      .run(
        day,
        source.sourceId,
        source.label,
        source.kind,
        source.capturedAt,
        Number(source.complete),
        source.status ?? (source.complete ? "complete" : "incomplete"),
        source.total.USD,
        source.total.CNY,
        source.total.HKD ?? null,
        source.assetClassTotals === undefined
          ? null
          : JSON.stringify(source.assetClassTotals),
      );
  }

  insertImportedHistory(
    observation: ImportedAssetSourceHistoryObservation,
  ): void {
    this.database
      .prepare(`
        INSERT INTO imported_asset_source_history_observations (
          source_id, day, label, kind, captured_at, complete, status,
          total_usd, total_cny, total_hkd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        observation.sourceId,
        observation.day,
        observation.label,
        observation.kind,
        observation.capturedAt,
        Number(observation.complete),
        observation.status ?? (observation.complete ? "complete" : "incomplete"),
        observation.total.USD,
        observation.total.CNY,
        observation.total.HKD ?? null,
      );
  }

  recordManual(
    source: AssetSourceSummary,
    record: ManualAssetRecord,
    capturedAt: string,
  ): void {
    const isCurrentDay = record.day === shanghaiDay(capturedAt);
    const currentObservation = isCurrentDay
      ? buildDailyAssetSnapshot(this.readModel.listSourcesSync(), capturedAt)
      : null;
    const manualSource = currentObservation?.sources.find(
      (item) => item.sourceId === source.id,
    ) ?? manualDailySource(source, record);

    const hasBaseline = this.database
      .prepare("SELECT day FROM daily_asset_snapshots WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasBaseline && currentObservation !== null) {
      this.insertBaseline(currentObservation);
    }

    const hasTrend = this.database
      .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
      .get(record.day) !== undefined;
    if (!hasTrend && currentObservation !== null) {
      this.upsertTrend(currentObservation);
    } else if (!hasTrend) {
      this.database
        .prepare(`
          INSERT INTO daily_asset_trend_observations (
            day, captured_at, complete, status, total_usd, total_cny, total_hkd,
            exchange_rates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.day,
          manualSource.capturedAt,
          Number(manualSource.complete),
          manualSource.status ?? "incomplete",
          manualSource.total.USD,
          manualSource.total.CNY,
          manualSource.total.HKD ?? null,
          "[]",
        );
      this.upsertSource(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
    } else {
      this.upsertSource(
        "daily_asset_source_trend_observations",
        record.day,
        manualSource,
      );
      this.recalculateTrend(record.day);
    }
  }

  recalculate(
    day: string,
    tables: {
      snapshot: "daily_asset_snapshots" | "daily_asset_trend_observations";
      source: "daily_asset_source_snapshots" | "daily_asset_source_trend_observations";
    },
  ): void {
    const sources = this.readModel.dailySourceRows(day, tables.source);
    if (sources.length === 0) {
      this.database.prepare(`DELETE FROM ${tables.snapshot} WHERE day = ?`).run(day);
      return;
    }
    const totals = (column: "total_usd" | "total_cny" | "total_hkd") => {
      const values = sources.flatMap((source) =>
        typeof source[column] === "string" ? [source[column]] : [],
      );
      return values.length > 0 ? decimalAdd(...values) : null;
    };
    const totalUsd = totals("total_usd");
    const complete =
      totalUsd !== null &&
      totals("total_hkd") !== null &&
      sources.every((source) => source.complete === 1);
    const status = sources.some((source) => source.status === "expired")
      ? "expired"
      : complete
        ? "complete"
        : "incomplete";
    this.database
      .prepare(`
        UPDATE ${tables.snapshot}
        SET complete = ?, status = ?, total_usd = ?, total_cny = ?, total_hkd = ?
        WHERE day = ?
      `)
      .run(
        Number(complete),
        status,
        totalUsd,
        totals("total_cny"),
        totals("total_hkd"),
        day,
      );
  }

  recalculateTrend(day: string): void {
    this.recalculate(day, {
      snapshot: "daily_asset_trend_observations",
      source: "daily_asset_source_trend_observations",
    });
  }

  record(snapshot: DailyAssetTrendObservation, createBaseline: boolean): void {
    const baseline = this.database
      .prepare("SELECT status FROM daily_asset_snapshots WHERE day = ?")
      .get(snapshot.day) as { status: "complete" | "incomplete" | "expired" }
        | undefined;
    if (baseline === undefined && createBaseline) {
      this.insertBaseline(snapshot);
    } else if (
      createBaseline &&
      baseline !== undefined &&
      baseline.status === "expired"
    ) {
      this.replaceExpiredBaseline(snapshot);
    }
    const hasTrend = this.database
      .prepare("SELECT day FROM daily_asset_trend_observations WHERE day = ?")
      .get(snapshot.day) !== undefined;
    const existing = hasTrend
      ? this.readModel.listDailyObservationsSync(
          "daily_asset_trend_observations", "daily_asset_source_trend_observations", snapshot.day,
        )[0]
      : undefined;
    this.upsertTrend(
      existing
        ? mergeDailyTrendObservation(existing, snapshot, !createBaseline)
        : snapshot,
    );
  }
}
