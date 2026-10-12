import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteDashboardDatabase } from "./production";
import type { DailyAssetTrendObservation } from "./ports";

function observation(day: string): DailyAssetTrendObservation {
  return { day, capturedAt: day + "T12:00:00.000Z", complete: true, status: "complete",
    total: { USD: "1", CNY: "7.2", HKD: "7.8" }, exchangeRates: [], sources: [{
      sourceId: "test-source", label: "测试", kind: "manual", capturedAt: day + "T12:00:00.000Z",
      complete: true, status: "complete", total: { USD: "1", CNY: "7.2", HKD: "7.8" },
    }] };
}

for (const days of [30, 365, 3650]) {
  test("单日写入保持历史，规模 " + days, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanban-history-query-"));
    const database = new SqliteDashboardDatabase(path.join(root, "db.sqlite"));
    const sql = (database as unknown as { database: DatabaseSync }).database;
    try {
      // Seed through the production business entry, exclusively in a temporary database.
      for (let i = 0; i < days; i++) {
        const day = new Date(Date.UTC(2015, 0, 1 + i)).toISOString().slice(0, 10);
        await database.recordDailyAssetObservation(observation(day), true);
      }
      const before = await database.listDailyAssetTrendObservations();
      const target = before.at(-1)!;
      let readRows = 0;
      const original = sql.prepare.bind(sql);
      sql.prepare = ((query: string) => {
        const statement = original(query);
        return new Proxy(statement, { get(object, key) {
          const method = Reflect.get(object, key);
          if (typeof method !== "function") return method;
          return (...args: unknown[]) => {
            const result = method.apply(object, args);
            if (key === "all") readRows += result.length;
            if (key === "get" && result) readRows++;
            return result;
          };
        } });
      }) as typeof sql.prepare;
      const start = performance.now();
      await database.recordDailyAssetObservation({ ...target, total: { USD: "2", CNY: "14.4", HKD: "15.6" } }, false);
      const elapsed = performance.now() - start;
      sql.prepare = original;
      assert.ok(readRows < 10, "单日写入不读取无关历史事实");
      const after = await database.listDailyAssetTrendObservations();
      assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
      assert.deepEqual((await database.listDailyAssetSnapshots()).at(-1), target);
      console.info(JSON.stringify({ operation: "single-day-write", days, readRows, elapsedMs: elapsed }));
    } finally { sql.close(); await rm(root, { recursive: true, force: true }); }
  });
}

