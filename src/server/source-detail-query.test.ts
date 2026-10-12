import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteDashboardDatabase } from "./production";
import { projectAssetSourceTrend } from "../domain/investment-performance-trend";

for (const days of [30, 365, 3650]) {
  test("详情仅读取所选来源和区间，规模 " + days, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanban-detail-query-"));
    const database = new SqliteDashboardDatabase(path.join(root, "db.sqlite"));
    const sql = (database as unknown as { database: DatabaseSync }).database;
    try {
      for (let i = 0; i < 3; i++) await database.createManualAssetSource({ label: "来源" + i }, "2015-01-01T00:00:00.000Z");
      const sources = await database.listSources();
      for (let i = 0; i < days; i++) {
        const day = new Date(Date.UTC(2015, 0, 1 + i)).toISOString().slice(0, 10);
        const capturedAt = day + "T12:00:00.000Z";
        await database.recordDailyAssetObservation({ day, capturedAt, complete: false, status: "incomplete", total: { USD: "0", CNY: null, HKD: null }, exchangeRates: [],
          sources: sources.map((source) => ({ sourceId: source.id, label: source.label, kind: source.kind, capturedAt, complete: false, status: "incomplete", total: { USD: String(i), CNY: null, HKD: null } })),
        }, false);
      }
      let rows = 0;
      const original = sql.prepare.bind(sql);
      sql.prepare = ((query: string) => {
        const statement = original(query);
        return new Proxy(statement, { get(object, key) {
          const value = Reflect.get(object, key);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => { const result = value.apply(object, args); if (key === "all") rows += result.length; if (key === "get" && result) rows++; return result; };
        } });
      }) as typeof sql.prepare;
      let started = performance.now();
      const full = await database.listDailyAssetTrendObservations();
      const baseline = { rows, ms: performance.now() - started, bytes: JSON.stringify(full).length };
      rows = 0; started = performance.now();
      const to = full.at(-1)!.day;
      const from = full.at(-7)!.day;
      const detail = await database.readSourceDetail({ sourceId: sources[0].id, from, to });
      const optimized = { rows, ms: performance.now() - started, bytes: JSON.stringify(detail.history).length };
      sql.prepare = original;
      assert.equal(detail.firstDay, full[0].day);
      assert.deepEqual(detail.sources, sources);
      assert.deepEqual(detail.history, full.slice(-7).map((day) => ({ ...day, sources: day.sources.filter((source) => source.sourceId === sources[0].id) })));
      const input = { currency: "CNY" as const, currentDay: to, preset: "custom" as const, customRange: { startDay: from, endDay: to }, sourceId: sources[0].id };
      assert.deepEqual(projectAssetSourceTrend({ ...input, trendObservations: detail.history }), projectAssetSourceTrend({ ...input, trendObservations: full }));
      assert.ok(optimized.rows <= 30);
      assert.deepEqual((await database.readSourceDetail({sourceId: sources[0].id})).history.length, days);
      console.info(JSON.stringify({ operation: "source-detail", days, baseline, optimized }));
    } finally { sql.close(); await rm(root, { recursive: true, force: true }); }
  });
}
