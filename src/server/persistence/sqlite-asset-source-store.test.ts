import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { BinanceAuthorizationResult } from "@/server/ports";
import { SqliteDashboardDatabase } from "./sqlite-database";

const capturedAt = "2026-10-01T01:00:00.000Z";
const authorization: BinanceAuthorizationResult = {
  credentials: "fixture-reference", permissions: ["account", "positions"],
  account: { id: "fixture-account", label: "Binance" },
  snapshot: {
    total: { amount: "100", currency: "USD" }, holdings: [],
    exchangeRates: [
      { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7", source: "fixture", observedAt: capturedAt },
      { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "fixture", observedAt: capturedAt },
    ], syncedAt: capturedAt,
  },
};

async function fixture(run: (database: SqliteDashboardDatabase, sql: DatabaseSync) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-source-transaction-"));
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

async function state(database: SqliteDashboardDatabase) {
  return {
    sources: await database.listSources(),
    cards: await database.listAssetCards(),
    records: await database.listManualAssetRecords(),
    baselines: await database.listDailyAssetSnapshots(),
    trends: await database.listDailyAssetTrendObservations(),
    investmentRecords: await database.listSourceInvestmentRecords(),
  };
}

test("接入来源末段失败回滚身份、快照和卡片，再次接入可写入首日观测", async () => {
  await fixture(async (database, sql) => {
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_first_observation BEFORE INSERT ON daily_asset_trend_observations
      BEGIN SELECT RAISE(ABORT, 'fixture observation failure'); END;`);
    await assert.rejects(database.connectLongbridge(authorization, "fixture-old", capturedAt), /fixture observation failure/);
    assert.deepEqual(await state(database), before);
    sql.exec("DROP TRIGGER reject_first_observation");
    await database.connectLongbridge(authorization, "fixture-old", capturedAt);
    assert.equal((await database.listSources()).length, 1);
    assert.equal((await database.listAssetCards()).length, 1);
    assert.equal((await database.listDailyAssetSnapshots())[0].total.USD, "100");
    assert.equal((await database.listDailyAssetTrendObservations())[0].total.USD, "100");
  });
});

test("手工记录更新与删除来源的跨表失败均完整回滚", async () => {
  await fixture(async (database, sql) => {
    await database.createManualAssetSource({ label: "手工资产" }, capturedAt);
    const source = (await database.listSources())[0];
    await database.recordManualAssetSource(source.id, { day: "2026-10-01", amount: "10", currency: "USD" }, capturedAt);
    await database.saveSourceInvestmentRecord(source.id, {
      id: "opening", day: "2026-10-01", kind: "opening", amount: "10", currency: "USD",
    }, capturedAt);
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_manual_observation BEFORE INSERT ON daily_asset_source_trend_observations
      BEGIN SELECT RAISE(ABORT, 'fixture manual failure'); END;`);
    await assert.rejects(database.recordManualAssetSource(source.id, { day: "2026-10-01", amount: "20", currency: "USD" }, capturedAt), /fixture manual failure/);
    assert.deepEqual(await state(database), before);
    sql.exec("DROP TRIGGER reject_manual_observation");
    sql.exec(`CREATE TRIGGER reject_delete_recalculation BEFORE DELETE ON daily_asset_snapshots
      BEGIN SELECT RAISE(ABORT, 'fixture deletion failure'); END;`);
    await assert.rejects(database.deleteAssetSourceData(source.id), /fixture deletion failure/);
    assert.deepEqual(await state(database), before);
    sql.exec("DROP TRIGGER reject_delete_recalculation");
    assert.equal(await database.deleteAssetSourceData(source.id), null);
    assert.deepEqual(await state(database), {
      sources: [], cards: [], records: [], baselines: [], trends: [], investmentRecords: [],
    });
  });
});

test("断开保留快照，重连核对账户并保留来源身份、卡片与历史观测", async () => {
  await fixture(async (database) => {
    await database.connectBinance(authorization, "fixture-old", capturedAt);
    const source = (await database.listSources())[0];
    const cards = await database.listAssetCards();
    const baselines = await database.listDailyAssetSnapshots();
    const trends = await database.listDailyAssetTrendObservations();
    assert.equal(await database.disconnectAssetSource(source.id), "fixture-old");
    assert.deepEqual((await database.listSources())[0].snapshot, source.snapshot);
    await assert.rejects(database.reconnectAssetSource(source.id, "binance", {
      ...authorization, account: { ...authorization.account, id: "different-account" },
    }, "fixture-new", capturedAt), /账户/);
    const updated = { ...authorization, snapshot: {
      ...authorization.snapshot, total: { amount: "150", currency: "USD" },
    } };
    assert.equal(await database.reconnectAssetSource(source.id, "binance", updated, "fixture-new", capturedAt), "fixture-old");
    const current = (await database.listSources())[0];
    assert.equal(current.id, source.id);
    assert.equal(current.lifecycle, "connected");
    assert.equal(current.snapshot.total.amount, "150");
    assert.equal(current.credentialReference, "fixture-new");
    assert.deepEqual(await database.listAssetCards(), cards);
    assert.deepEqual(await database.listDailyAssetSnapshots(), baselines);
    assert.deepEqual(await database.listDailyAssetTrendObservations(), trends);
  });
});

test("重连来源写入失败时连接状态、凭证和快照整批回滚", async () => {
  await fixture(async (database, sql) => {
    await database.connectBinance(authorization, "fixture-old", capturedAt);
    const source = (await database.listSources())[0];
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_source_reconnect
      BEFORE UPDATE ON asset_sources
      WHEN NEW.lifecycle = 'connected'
      BEGIN SELECT RAISE(ABORT, 'fixture reconnect failure'); END;`);
    await assert.rejects(
      database.reconnectAssetSource(
        source.id,
        "binance",
        {
          ...authorization,
          snapshot: {
            ...authorization.snapshot,
            total: { amount: "200", currency: "USD" },
          },
        },
        "fixture-new",
        capturedAt,
      ),
      /fixture reconnect failure/,
    );
    assert.deepEqual(await state(database), before);
  });
});

test("来源资料与快照写入失败时连接结果整批回滚", async () => {
  await fixture(async (database, sql) => {
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_source_snapshot
      BEFORE INSERT ON asset_source_snapshots
      BEGIN SELECT RAISE(ABORT, 'fixture source snapshot failure'); END;`);
    await assert.rejects(
      database.connectBinance(authorization, "fixture-old", capturedAt),
      /fixture source snapshot failure/,
    );
    assert.deepEqual(await state(database), before);
  });
});

test("手工来源卡片写入失败时来源与快照整批回滚", async () => {
  await fixture(async (database, sql) => {
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_manual_source_card
      BEFORE INSERT ON asset_cards
      BEGIN SELECT RAISE(ABORT, 'fixture manual source card failure'); END;`);
    await assert.rejects(
      database.createManualAssetSource({ label: "手工资产" }, capturedAt),
      /fixture manual source card failure/,
    );
    assert.deepEqual(await state(database), before);
  });
});

test("卡片布局替换失败时整批回滚，隐藏状态只更新对应来源", async () => {
  await fixture(async (database, sql) => {
    await database.connectBinance(authorization, "fixture-old", capturedAt);
    await database.createManualAssetSource({ label: "手工资产" }, capturedAt);
    const before = await database.listAssetCards();
    const sources = await database.listSources();
    assert.equal(before.length, 2);

    sql.exec(`CREATE TRIGGER reject_card_layout
      BEFORE INSERT ON asset_cards
      WHEN NEW.id = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'fixture card layout failure'); END;`);
    await assert.rejects(
      database.replaceAssetCards([
        { ...before[0], id: "rejected" },
        before[1],
      ]),
      /fixture card layout failure/,
    );
    assert.deepEqual(await database.listAssetCards(), before);

    sql.exec("DROP TRIGGER reject_card_layout");
    await database.setAssetCardHidden(sources[0].id, true);
    const hidden = await database.listAssetCards();
    assert.equal(hidden.find((card) => card.sourceId === sources[0].id)?.hidden, true);
    assert.equal(hidden.find((card) => card.sourceId === sources[1].id)?.hidden, undefined);
  });
});

test("手工资产原始记录写入失败时来源快照和观测整批回滚", async () => {
  await fixture(async (database, sql) => {
    await database.createManualAssetSource({ label: "手工资产" }, capturedAt);
    const source = (await database.listSources())[0];
    await database.recordManualAssetSource(
      source.id,
      { day: "2026-10-01", amount: "10", currency: "USD" },
      capturedAt,
    );
    const before = await state(database);
    sql.exec(`CREATE TRIGGER reject_manual_record_write
      BEFORE INSERT ON manual_asset_records
      BEGIN SELECT RAISE(ABORT, 'fixture manual record failure'); END;`);
    await assert.rejects(
      database.recordManualAssetSource(
        source.id,
        { day: "2026-10-01", amount: "20", currency: "USD" },
        capturedAt,
      ),
      /fixture manual record failure/,
    );
    assert.deepEqual(await state(database), before);
    sql.exec("DROP TRIGGER reject_manual_record_write");
    await database.recordManualAssetSource(
      source.id,
      { day: "2026-10-01", amount: "20", currency: "USD" },
      capturedAt,
    );
    assert.equal((await database.listManualAssetRecords())[0].amount, "20");
  });
});
