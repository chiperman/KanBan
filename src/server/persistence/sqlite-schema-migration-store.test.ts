import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SQLITE_SCHEMA_VERSION } from "./contracts";
import { SqliteDashboardDatabase } from "./sqlite-database";

/**
 * v1 是首个 SQLite 产物的 Schema；历史上 `SqliteDashboardDatabase` 只落 Tables：
 * schema_metadata、asset_sources（credential_reference NOT NULL）、asset_source_snapshots、
 * asset_source_sync_states、asset_cards、daily_asset_snapshots、daily_asset_source_snapshots。
 * 这里按该形状构造，避免用当前 Schema 降级掩盖历史差异。
 */
function createVersionOneFixture(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE schema_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE asset_sources (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      account_id TEXT NOT NULL,
      permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
      credential_reference TEXT NOT NULL,
      lifecycle TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('connected', 'disconnected'))
    ) STRICT;
    CREATE TABLE asset_source_snapshots (
      source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
      total_amount TEXT NOT NULL,
      total_currency TEXT NOT NULL,
      holdings_json TEXT NOT NULL CHECK (json_valid(holdings_json)),
      exchange_rates_json TEXT NOT NULL CHECK (json_valid(exchange_rates_json)),
      synced_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE asset_source_sync_states (
      source_id TEXT PRIMARY KEY REFERENCES asset_sources(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('current', 'expired')),
      last_successful_at TEXT NOT NULL,
      last_attempt_at TEXT NOT NULL,
      error TEXT,
      failed_mode TEXT CHECK (failed_mode IS NULL OR failed_mode IN ('all', 'prices', 'holdings'))
    ) STRICT;
    CREATE TABLE asset_cards (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source_id TEXT,
      hidden INTEGER CHECK (hidden IS NULL OR hidden IN (0, 1)),
      span INTEGER NOT NULL CHECK (span IN (1, 2, 3)),
      starts_new_row INTEGER CHECK (starts_new_row IS NULL OR starts_new_row IN (0, 1))
    ) STRICT;
    CREATE TABLE daily_asset_snapshots (
      day TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
      total_usd TEXT,
      total_cny TEXT
    ) STRICT;
    CREATE TABLE daily_asset_source_snapshots (
      day TEXT NOT NULL REFERENCES daily_asset_snapshots(day) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
      total_usd TEXT,
      total_cny TEXT,
      PRIMARY KEY (day, source_id)
    ) STRICT;
    INSERT INTO schema_metadata VALUES ('schema_version', '1'), ('json_import_complete', '1');
  `);
  database.exec(`
    INSERT INTO asset_sources VALUES (
      'v1-binance', 0, 'binance', 'V1 Binance', 'v1-account',
      '["account","positions"]', 'v1-credential-reference', 'connected'
    );
    INSERT INTO asset_source_snapshots VALUES (
      'v1-binance', '100', 'USD', '[]', '[]', '2026-07-28T01:00:00.000Z'
    );
    INSERT INTO asset_source_sync_states VALUES (
      'v1-binance', 'current', '2026-07-28T01:00:00.000Z', '2026-07-28T01:00:00.000Z', NULL, NULL
    );
    INSERT INTO asset_cards VALUES ('v1-card', 0, 'V1 卡片', '历史卡片', NULL, 0, 1, 0);
    INSERT INTO daily_asset_snapshots VALUES (
      '2026-07-27', '2026-07-28T01:00:00.000Z', 1, '100', '720'
    );
    INSERT INTO daily_asset_source_snapshots VALUES (
      '2026-07-27', 'v1-binance', 'V1 Binance', 'binance',
      '2026-07-28T01:00:00.000Z', 1, '100', '720'
    );
  `);
}

async function withVersionOneFixture(
  run: (databasePath: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-schema-v1-"));
  const databasePath = path.join(root, "data.sqlite");
  try {
    const bootstrap = new DatabaseSync(databasePath);
    createVersionOneFixture(bootstrap);
    bootstrap.close();
    await run(databasePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("SQLite v1 产品库回放全部历史迁移到当前版本，保留凭证引用与业务数据", async () => {
  await withVersionOneFixture(async (databasePath) => {
    const migrated = new SqliteDashboardDatabase(databasePath);
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(
        (inspection
          .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
          .get() as { value: string }).value,
        String(SQLITE_SCHEMA_VERSION),
      );
      const sources = await migrated.listSources();
      assert.equal(sources.length, 1);
      assert.equal(sources[0].id, "v1-binance");
      assert.equal(sources[0].credentialReference, "v1-credential-reference");
      assert.equal(sources[0].accountId, "v1-account");
      assert.deepEqual(sources[0].permissions, ["account", "positions"]);
      assert.equal(sources[0].snapshot?.total.amount, "100");
      assert.equal(sources[0].lifecycle, "connected");
      assert.deepEqual(await migrated.listAssetCards(), [
        {
          id: "v1-card",
          kind: "asset",
          title: "V1 卡片",
          body: "历史卡片",
          hidden: false,
          span: 1,
          startsNewRow: false,
        },
      ]);
      const baselines = await migrated.listDailyAssetSnapshots();
      assert.equal(baselines.length, 1);
      assert.equal(baselines[0].day, "2026-07-27");
      assert.deepEqual(baselines[0].total, { USD: "100", CNY: "720", HKD: null });
      // v4 把日快照拆出独立趋势观测：迁移既要保留原视始日快照，也要补一行同值观测。
      const trends = await migrated.listDailyAssetTrendObservations();
      assert.equal(trends.length, 1);
      assert.equal(trends[0].day, "2026-07-27");
      assert.deepEqual(trends[0].total, { USD: "100", CNY: "720", HKD: null });
      assert.equal(trends[0].sources[0].sourceId, "v1-binance");
      assert.deepEqual(trends[0].sources[0].total, {
        USD: "100",
        CNY: "720",
        HKD: null,
      });
    } finally {
      inspection.close();
      migrated.close();
    }
  });
});

test("SQLite v1 产品库重开后仍可写入并保持投入历史分表可用", async () => {
  await withVersionOneFixture(async (databasePath) => {
    const first = new SqliteDashboardDatabase(databasePath);
    await first.recordDailyAssetObservation(
      {
        day: "2026-08-01",
        capturedAt: "2026-08-01T02:00:00.000Z",
        complete: false,
        status: "incomplete",
        total: { USD: "120", CNY: "864", HKD: null },
        exchangeRates: [],
        sources: [
          {
            sourceId: "v1-binance",
            label: "V1 Binance",
            kind: "binance",
            capturedAt: "2026-08-01T02:00:00.000Z",
            complete: false,
            status: "incomplete",
            total: { USD: "120", CNY: "864", HKD: null },
          },
        ],
      },
      true,
    );
    await first.createInvestmentCashflow({
      id: "v1-initial",
      kind: "initial-investment",
      occurredAt: "2026-07-01T00:00:00.000Z",
      amount: "1000",
      currency: "USD",
      amounts: { USD: "1000", CNY: "7200", HKD: "7800" },
      note: "v1 回放后写入",
      exchangeRates: [],
      createdAt: "2026-08-01T02:00:00.000Z",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    first.close();

    const restarted = new SqliteDashboardDatabase(databasePath);
    try {
      const trends = await restarted.listDailyAssetTrendObservations();
      assert.deepEqual(
        trends.map((trend) => trend.day).sort(),
        ["2026-07-27", "2026-08-01"],
      );
      assert.deepEqual(await restarted.listInvestmentCashflows(), [
        {
          id: "v1-initial",
          kind: "initial-investment",
          occurredAt: "2026-07-01T00:00:00.000Z",
          amount: "1000",
          currency: "USD",
          amounts: { USD: "1000", CNY: "7200", HKD: "7800" },
          note: "v1 回放后写入",
          exchangeRates: [],
          createdAt: "2026-08-01T02:00:00.000Z",
          updatedAt: "2026-08-01T02:00:00.000Z",
        },
      ]);
      // v16 新增的历史分表可选为客户提供为空，重开后仍可查询。
      assert.deepEqual(await restarted.listImportedSourceHistoryObservations(), []);
    } finally {
      restarted.close();
    }
  });
});

test("SQLite v1 回放补齐日观测的状态、HKD 与观测汇率列", async () => {
  await withVersionOneFixture(async (databasePath) => {
    const migrated = new SqliteDashboardDatabase(databasePath);
    try {
      const columns = (
        migrated as unknown as { database: DatabaseSync }
      ).database
        .prepare("PRAGMA table_info(daily_asset_trend_observations)")
        .all() as Array<{ name: string }>;
      const names = columns.map((column) => column.name);
      // v5/v6/v7 逐列加宽：状态、HKD 与观测汇率都必须出现，否则新写入会因 CHECK 失败。
      for (const column of ["status", "total_hkd", "exchange_rates_json"]) {
        assert.ok(names.includes(column), `缺少列 ${column}`);
      }
    } finally {
      migrated.close();
    }
  });
});
