import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteDashboardDatabase } from "./production";
import type { FormalDailySettlement } from "./ports";

for (const days of [30, 365, 3650]) {
  test("正式日结批量读取保持全部证据，规模 " + days, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanban-settlement-query-"));
    const database = new SqliteDashboardDatabase(path.join(root, "db.sqlite"), path.join(root, "absent.json"), path.join(root, "cards.json"));
    const sql = (database as unknown as { database: DatabaseSync }).database;
    try {
      assert.deepEqual(await database.listFormalDailySettlements(), []);
      await database.createManualAssetSource({ label: "查询样例" }, "2015-01-01T00:00:00.000Z");
      const sourceId = (await database.listSources())[0].id;
      const expected: FormalDailySettlement[] = [];
      for (let i = 0; i < days; i++) {
        // Gaps are intentional; no missing date may be invented.
        const day = new Date(Date.UTC(2015, 0, 1 + i * 2)).toISOString().slice(0, 10);
        const capturedAt = day + "T16:00:00.000Z";
        const item: FormalDailySettlement = {
          anchor: { key: "crypto-cutoff:" + day, kind: "crypto-cutoff", market: null, tradingDay: day, scheduledCloseAt: capturedAt },
          capturedAt, status: "incomplete", diagnostic: "缺少汇率", total: { USD: "0", CNY: null, HKD: null },
          exchangeRates: [{ baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "Longbridge", observedAt: capturedAt }],
          sources: [{ sourceId, label: "样例", kind: "manual", capturedAt, status: "incomplete", diagnostic: null, total: { USD: "0", CNY: null, HKD: null } }],
          holdings: [{ sourceId, sourceAsset: "cash", symbol: "USD", name: "现金", quantity: "0", assetClass: "cash", price: { amount: "1", currency: "USD" }, priceBasis: "capture-time", priceObservedAt: capturedAt, market: null, marketTradingDay: null, marketValue: "0", diagnostic: null }],
        };
        await database.recordFormalDailySettlementIfAbsent(item);
        expected.unshift(item);
      }
      let queries = 0;
      const original = sql.prepare.bind(sql);
      sql.prepare = ((query: string) => { queries++; return original(query); }) as typeof sql.prepare;
      const start = performance.now();
      const actual = await database.listFormalDailySettlements();
      const elapsedMs = performance.now() - start;
      sql.prepare = original;
      assert.deepEqual(actual, expected);
      assert.ok(queries < days, "不逐日读取子记录");
      assert.equal(await database.recordFormalDailySettlementIfAbsent({ ...expected[0], diagnostic: "不得改写" }), false);
      assert.deepEqual(await database.listFormalDailySettlements(), expected);
      console.info(JSON.stringify({ operation: "formal-history", days, queries, elapsedMs }));
    } finally { sql.close(); await rm(root, { recursive: true, force: true }); }
  });
}
