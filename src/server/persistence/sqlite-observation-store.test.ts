import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { DailyAssetSnapshot } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";

test("观测子项写入失败同时回滚当日基准与趋势替换", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-observation-transaction-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const sql = (database as unknown as { database: DatabaseSync }).database;
  const prepare = sql.prepare.bind(sql);
  try {
    const initial: DailyAssetSnapshot = {
      day: "2026-10-01",
      capturedAt: "2026-10-01T01:00:00.000Z",
      complete: true,
      status: "complete",
      total: { USD: "10", CNY: "70", HKD: "78" },
      exchangeRates: [],
      sources: [{
        sourceId: "fixture",
        label: "fixture",
        kind: "manual",
        capturedAt: "2026-10-01T01:00:00.000Z",
        complete: true,
        status: "complete",
        total: { USD: "10", CNY: "70", HKD: "78" },
      }],
    };
    await database.recordDailyAssetObservation(initial, true);
    const baselines = await database.listDailyAssetSnapshots();
    const trends = await database.listDailyAssetTrendObservations();
    sql.prepare = ((query: string) => {
      if (query.includes("INSERT INTO daily_asset_source_trend_observations")) {
        throw new Error("fixture child write failure");
      }
      return prepare(query);
    }) as typeof sql.prepare;

    for (const day of ["2026-10-01", "2026-10-02"]) {
      await assert.rejects(database.recordDailyAssetObservation({
        ...initial,
        day,
        total: { USD: "20", CNY: "140", HKD: "156" },
      }, true), /fixture child write failure/);
      assert.deepEqual(await database.listDailyAssetSnapshots(), baselines);
      assert.deepEqual(await database.listDailyAssetTrendObservations(), trends);
    }
  } finally {
    sql.prepare = prepare;
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});
