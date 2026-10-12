import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { BusinessDataState } from "@/server/backup/document-codec";
import type { FormalDailySettlement } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";

const capturedAt = "2026-10-01T01:00:00.000Z";

async function fixture(
  run: (database: SqliteDashboardDatabase, sql: DatabaseSync) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-business-data-store-"));
  const database = new SqliteDashboardDatabase(
    path.join(root, "data.sqlite"),
    path.join(root, "absent.json"),
    path.join(root, "absent-cards.json"),
  );
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    await run(database, sql);
  } finally {
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function readState(database: SqliteDashboardDatabase): Promise<BusinessDataState> {
  return {
    assetCards: await database.listAssetCards(),
    assetSources: await database.listSources(),
    dailyAssetSnapshots: await database.listDailyAssetSnapshots(),
    dailyAssetTrendObservations: await database.listDailyAssetTrendObservations(),
    importedAssetSourceHistoryObservations: await database.listImportedSourceHistoryObservations(),
    investmentCashflows: await database.listInvestmentCashflows(),
    manualAssetRecords: await database.listManualAssetRecords(),
    formalDailySettlements: await database.listFormalDailySettlements(),
  };
}

function settlement(sourceId = "manual-source"): FormalDailySettlement {
  return {
    anchor: {
      key: "crypto-cutoff:2026-10-01",
      kind: "crypto-cutoff",
      market: null,
      tradingDay: "2026-10-01",
      scheduledCloseAt: "2026-10-01T16:00:00.000Z",
    },
    capturedAt: capturedAt,
    status: "incomplete",
    diagnostic: "fixture",
    total: { USD: "10", CNY: null, HKD: null },
    exchangeRates: [],
    sources: [{
      sourceId,
      label: "手工来源",
      kind: "manual",
      capturedAt,
      status: "incomplete",
      diagnostic: "fixture",
      total: { USD: "10", CNY: null, HKD: null },
    }],
    holdings: [{
      sourceId,
      sourceAsset: "fixture-cash",
      symbol: "USD",
      name: "测试现金",
      quantity: "10",
      assetClass: "cash",
      price: { amount: "1", currency: "USD" },
      priceBasis: "capture-time",
      priceObservedAt: capturedAt,
      market: null,
      marketTradingDay: null,
      marketValue: "10",
      diagnostic: null,
    }],
  };
}

async function seed(database: SqliteDashboardDatabase): Promise<BusinessDataState> {
  await database.createManualAssetSource({ label: "手工来源" }, capturedAt);
  const source = (await database.listSources())[0];
  await database.recordManualAssetSource(
    source.id,
    { day: "2026-10-01", amount: "10", currency: "USD" },
    capturedAt,
  );
  await database.createInvestmentCashflow({
    id: "cashflow",
    kind: "initial-investment",
    occurredAt: "2026-09-30T00:00:00.000Z",
    amount: "10",
    currency: "USD",
    note: "fixture",
    amounts: { USD: "10", CNY: null, HKD: null },
    exchangeRates: [],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  });
  await database.recordFormalDailySettlementIfAbsent(settlement(source.id));
  return readState(database);
}

test("完整业务恢复写入替换来源、卡片、观测、账本、手工记录和正式日结", async () => {
  await fixture(async (database) => {
    const original = await seed(database);
    await database.replaceBusinessData({
      ...original,
      investmentCashflows: [{
        ...original.investmentCashflows[0],
        amount: "20",
        amounts: { USD: "20", CNY: null, HKD: null },
      }],
    });
    const restored = await readState(database);
    assert.equal(restored.assetSources.length, 1);
    assert.equal(restored.assetCards.length, 1);
    assert.equal(restored.manualAssetRecords.length, 1);
    assert.equal(restored.investmentCashflows[0].amount, "20");
    assert.deepEqual(restored.formalDailySettlements, original.formalDailySettlements);
    assert.equal(restored.dailyAssetSnapshots.length, original.dailyAssetSnapshots.length);
    assert.equal(restored.dailyAssetTrendObservations.length, original.dailyAssetTrendObservations.length);
  });
});

test("完整业务恢复在手工记录写入失败时整批回滚，既有状态保持不变", async () => {
  await fixture(async (database, sql) => {
    const original = await seed(database);
    sql.exec(`CREATE TRIGGER reject_restored_manual_record
      BEFORE INSERT ON manual_asset_records
      BEGIN SELECT RAISE(ABORT, 'fixture business restore failure'); END;`);
    await assert.rejects(
      database.replaceBusinessData(original),
      /fixture business restore failure/,
    );
    assert.deepEqual(await readState(database), original);
    sql.exec("DROP TRIGGER reject_restored_manual_record");
    await database.replaceBusinessData(original);
    assert.deepEqual(await readState(database), original);
  });
});

test("完整业务恢复委托手工资产记录模块并保留记录字段", async () => {
  await fixture(async (database) => {
    const original = await seed(database);
    await database.replaceBusinessData({
      ...original,
      manualAssetRecords: [{
        sourceId: original.manualAssetRecords[0].sourceId,
        day: "2026-10-02",
        amount: "30",
        currency: "USD",
        recordedAt: capturedAt,
      }],
    });
    assert.deepEqual(await database.listManualAssetRecords(), [{
      sourceId: original.manualAssetRecords[0].sourceId,
      day: "2026-10-02",
      amount: "30",
      currency: "USD",
      recordedAt: capturedAt,
    }]);
  });
});
