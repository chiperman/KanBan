import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { FormalDailySettlement } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";
import { SqliteFormalSettlementReadStore } from "./sqlite-formal-settlement-read-store";

const capturedAt = "2026-10-01T16:05:00.000Z";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-formal-settlement-store-"));
  const database = new SqliteDashboardDatabase(
    path.join(root, "data.sqlite"),
    path.join(root, "absent.json"),
    path.join(root, "absent-cards.json"),
  );
  const sql = (database as unknown as { database: DatabaseSync }).database;
  t.after(async () => {
    sql.close();
    await rm(root, { recursive: true, force: true });
  });
  await database.createManualAssetSource({ label: "来源一" }, capturedAt);
  await database.createManualAssetSource({ label: "来源二" }, capturedAt);
  const [first, second] = await database.listSources();
  return { database, sql, sourceIds: [first.id, second.id] as const };
}

function settlement(sourceIds: readonly [string, string], key = "crypto-cutoff:2026-10-01"): FormalDailySettlement {
  const [first, second] = sourceIds;
  return {
    anchor: {
      key, kind: "crypto-cutoff", market: null, tradingDay: "2026-10-01",
      scheduledCloseAt: "2026-10-01T16:00:00.000Z",
    },
    capturedAt, status: "incomplete", diagnostic: "缺少行情",
    total: { USD: "0", CNY: null, HKD: "0" },
    exchangeRates: [{
      baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8",
      source: "fixture", observedAt: capturedAt,
    }],
    sources: [second, first].map((sourceId, index) => ({
      sourceId, label: "证据来源" + index, kind: "manual",
      capturedAt: index === 0 ? null : capturedAt,
      status: index === 0 ? "missed" : "complete",
      diagnostic: index === 0 ? "错过采集" : null,
      total: { USD: index === 0 ? null : "0", CNY: null, HKD: "0" },
    })),
    holdings: [{
      sourceId: first, sourceAsset: "stock:one", symbol: "SAME", name: "证券一",
      quantity: "0.123456789", assetClass: "securities",
      price: { amount: "1.123456789", currency: "HKD" }, priceBasis: "official-close",
      priceObservedAt: "2026-10-01T08:00:00.000Z", market: "HK",
      marketTradingDay: "2026-10-01", marketValue: "0.138698366750190521", diagnostic: null,
    }, {
      sourceId: first, sourceAsset: "stock:two", symbol: "SAME", name: "证券二",
      quantity: "1", assetClass: "securities", price: null, priceBasis: "unavailable",
      priceObservedAt: null, market: "US", marketTradingDay: "2026-09-30",
      marketValue: null, diagnostic: "缺少正式收盘价",
    }, {
      sourceId: second, sourceAsset: null, symbol: "USD", name: "现金",
      quantity: "0", assetClass: "cash", price: { amount: "1", currency: "USD" },
      priceBasis: "capture-time", priceObservedAt: capturedAt, market: null,
      marketTradingDay: null, marketValue: "0", diagnostic: null,
    }],
  };
}

test("正式日结只读模块批量读取两类锚点，保留子项顺序、精度与缺失证据", async (t) => {
  const { database, sql, sourceIds } = await fixture(t);
  const reader = new SqliteFormalSettlementReadStore(sql);
  assert.deepEqual(reader.list(), []);
  const crypto = settlement(sourceIds, "a-crypto");
  const securities: FormalDailySettlement = {
    ...settlement(sourceIds, "z-securities"),
    anchor: { ...crypto.anchor, key: "z-securities", kind: "securities-close", market: "HK" },
  };
  const missed: FormalDailySettlement = {
    ...crypto,
    anchor: { ...crypto.anchor, key: "missed", tradingDay: "2026-09-29", scheduledCloseAt: "2026-09-29T16:00:00.000Z" },
    capturedAt: null, status: "missed", diagnostic: "错过窗口",
    total: { USD: null, CNY: null, HKD: null }, exchangeRates: [], sources: [], holdings: [],
  };
  for (const item of [crypto, missed, securities]) {
    assert.equal(await database.recordFormalDailySettlementIfAbsent(item), true);
  }
  sql.exec("PRAGMA query_only = ON");
  const prepare = sql.prepare.bind(sql);
  const queries: string[] = [];
  t.mock.method(sql, "prepare", (query: string) => {
    queries.push(query);
    return prepare(query);
  });
  const expected = [securities, crypto, missed];
  assert.deepEqual(reader.list(), expected);
  assert.equal(queries.length, 3, "只批量读取主表和两个子表，不逐日查询");
  t.mock.restoreAll();
  assert.deepEqual(await database.listFormalDailySettlements(), expected);
});

test("正式日结重复锚点不改写证据，也不尝试插入冲突子项", async (t) => {
  const { database, sql, sourceIds } = await fixture(t);
  const original = settlement(sourceIds);
  assert.equal(await database.recordFormalDailySettlementIfAbsent(original), true);
  sql.exec(`CREATE TRIGGER reject_duplicate_child BEFORE INSERT ON formal_daily_settlement_sources
    BEGIN SELECT RAISE(ABORT, 'fixture duplicate child write'); END;`);
  assert.equal(await database.recordFormalDailySettlementIfAbsent({
    ...original,
    diagnostic: "不得覆盖",
    total: { USD: "999", CNY: "999", HKD: "999" },
    sources: original.sources.map((source) => ({ ...source, label: "不得覆盖" })),
    holdings: original.holdings.map((holding) => ({ ...holding, quantity: "999" })),
  }), false);
  assert.deepEqual(await database.listFormalDailySettlements(), [original]);
});

for (const table of ["formal_daily_settlement_sources", "formal_daily_settlement_holdings"] as const) {
  test(`正式日结 ${table} 中途写入失败时三表整批回滚，重试可完整保存`, async (t) => {
    const { database, sql, sourceIds } = await fixture(t);
    const original = settlement(sourceIds, "original");
    const incoming = settlement(sourceIds, "incoming");
    assert.equal(await database.recordFormalDailySettlementIfAbsent(original), true);
    const counts = () => [
      "formal_daily_settlements", "formal_daily_settlement_sources", "formal_daily_settlement_holdings",
    ].map((name) => sql.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count);
    const before = counts();
    // 来源列表先写 second，持仓列表先写 first，确保失败发生前已有子项写入。
    const failedSourceId = table === "formal_daily_settlement_sources" ? sourceIds[0] : sourceIds[1];
    sql.exec(`CREATE TRIGGER reject_settlement_child BEFORE INSERT ON ${table}
      WHEN NEW.anchor_key = 'incoming' AND NEW.source_id = '${failedSourceId}'
      BEGIN SELECT RAISE(ABORT, 'fixture settlement child failure'); END;`);
    await assert.rejects(database.recordFormalDailySettlementIfAbsent(incoming), /fixture settlement child failure/);
    assert.deepEqual(counts(), before);
    assert.deepEqual(await database.listFormalDailySettlements(), [original]);
    sql.exec("DROP TRIGGER reject_settlement_child");
    assert.equal(await database.recordFormalDailySettlementIfAbsent(incoming), true);
    assert.deepEqual(await database.listFormalDailySettlements(), [original, incoming]);
  });
}
