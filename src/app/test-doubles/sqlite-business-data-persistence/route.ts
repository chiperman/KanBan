import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  SqliteDashboardDatabase,
  createProductionServices,
} from "@/server/production";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import type {
  AssetSnapshot,
  AssetSourceSummary,
  BinanceAuthorizationResult,
  DailyAssetSnapshot,
  EvmWatchAuthorizationResult,
} from "@/server/ports";

export const dynamic = "force-dynamic";

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

function displayMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function legacyDashboard() {
  const capturedAt = "2026-07-27T04:00:00.000Z";
  return {
    schemaVersion: 5,
    assetCards: [
      {
        id: "legacy-card",
        kind: "asset",
        title: "旧资产卡片",
        body: "旧布局",
        sourceId: "legacy-source",
        hidden: true,
        span: 2,
        startsNewRow: true,
      },
    ],
    assetSources: [
      {
        id: "legacy-source",
        kind: "binance",
        label: "旧 Binance",
        accountId: "legacy-account",
        permissions: ["account", "positions"],
        credentialReference: "opaque-reference",
        lifecycle: "disconnected",
        snapshot: {
          total: { amount: "12.5", currency: "USD" },
          holdings: [
            {
              symbol: "USD",
              name: "US Dollar",
              quantity: "12.5",
              currency: "USD",
              assetClass: "crypto",
              currentPrice: { amount: "1", currency: "USD" },
              marketValue: "12.5",
              sourceMarketValue: { amount: "12.5", currency: "USD" },
              valuation: {
                status: "valued",
                priceSource: "旧 Binance",
                pricedAt: capturedAt,
              },
              costPrice: null,
              platformProfit: null,
              changePercent: null,
            },
          ],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      },
    ],
    dailyAssetSnapshots: [
      {
        day: "2026-07-27",
        capturedAt,
        complete: true,
        total: { USD: "12.5", CNY: "90" },
        sources: [
          {
            sourceId: "legacy-source",
            label: "旧 Binance",
            kind: "binance",
            capturedAt,
            complete: true,
            total: { USD: "12.5", CNY: "90" },
          },
        ],
      },
    ],
  };
}

async function writeLegacyDashboard(dataDirectory: string): Promise<string> {
  await mkdir(dataDirectory, { recursive: true });
  const dashboardPath = path.join(dataDirectory, "dashboard.json");
  const contents = JSON.stringify(legacyDashboard(), null, 2);
  await writeFile(dashboardPath, contents);
  await chmod(dashboardPath, 0o600);
  return contents;
}

function authorization(
  accountId: string,
  credentials: string,
  invalidSnapshot = false,
): BinanceAuthorizationResult {
  const snapshot = legacyDashboard().assetSources[0].snapshot as unknown as
    AssetSnapshot;
  return {
    credentials,
    permissions: ["account", "positions"],
    account: { id: accountId, label: `Binance ${accountId}` },
    snapshot: invalidSnapshot
      ? {
          ...snapshot,
          holdings: [...snapshot.holdings, 1n as never],
        }
      : snapshot,
  };
}

function evmAuthorization(): EvmWatchAuthorizationResult {
  const capturedAt = "2026-08-02T02:00:00.000Z";
  return {
    credentials: JSON.stringify({
      chain: "bsc",
      addresses: ["0x1111111111111111111111111111111111111111"],
    }),
    chain: "bsc",
    permissions: ["public-address", "market-data", "positions"],
    account: {
      id: "evm:56:preference-persistence",
      label: "BNB Smart Chain 观察钱包 · 1 个地址",
    },
    snapshot: {
      total: { amount: "600", currency: "USD" },
      holdings: [
        {
          symbol: "BNB",
          name: "BNB Smart Chain",
          sourceAsset: "evm:56:native",
          quantity: "1",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "600", currency: "USD" },
          marketValue: "600",
          sourceMarketValue: { amount: "600", currency: "USD" },
          valuation: {
            status: "valued",
            priceSource: "CoinGecko BNB Smart Chain/USD 参考价格",
            pricedAt: capturedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "UNKNOWN",
          name: "UNKNOWN · BNB Smart Chain BEP-20",
          sourceAsset:
            "evm:56:0xcccccccccccccccccccccccccccccccccccccccc",
          quantity: "1000",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued",
            reason: "CoinGecko 未返回可靠 USD 参考价格",
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      ],
      exchangeRates: [],
      syncedAt: capturedAt,
    },
  };
}

function legacyLongbridgeOptionSource(): AssetSourceSummary {
  const syncedAt = "2026-07-30T08:00:00.000Z";
  return {
    id: "legacy-longbridge-option",
    kind: "longbridge",
    label: "长桥美股",
    accountId: "legacy-longbridge-option-account",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "legacy-longbridge-option-reference",
    snapshot: {
      total: { amount: "69930.10", currency: "USD" },
      holdings: [
        {
          symbol: "NVDA260805C210000.US",
          name: "NVDA 260805 210 Call",
          quantity: "-1",
          currency: "USD",
          assetClass: "securities",
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued",
            reason: "Longbridge 未返回可靠价格",
          },
          costPrice: "0.450",
          platformProfit: null,
          changePercent: null,
        },
      ],
      exchangeRates: [],
      syncedAt,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: syncedAt,
      lastAttemptAt: syncedAt,
      error: null,
    },
  };
}

function longbridgeReferenceSource(): AssetSourceSummary {
  const syncedAt = "2026-08-05T00:00:00.000Z";
  return {
    id: "longbridge-reference-source",
    kind: "longbridge",
    label: "长桥参考账户",
    accountId: "longbridge:reference",
    permissions: ["account", "positions", "market-data"],
    credentialReference: "opaque-reference",
    snapshot: {
      total: { amount: "10000", currency: "USD" },
      holdings: [],
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        source: "Longbridge",
        observedAt: syncedAt,
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "Longbridge",
        observedAt: syncedAt,
      }],
      syncedAt,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: syncedAt,
      lastAttemptAt: syncedAt,
      error: null,
    },
  };
}

function dailySnapshot(
  sourceId: string,
  usd: string,
  cny: string,
): DailyAssetSnapshot {
  const capturedAt = "2026-07-28T02:00:00.000Z";
  return {
    day: "2026-07-28",
    capturedAt,
    complete: true,
    total: { USD: usd, CNY: cny },
    sources: [
      {
        sourceId,
        label: sourceId,
        kind: "test",
        capturedAt,
        complete: true,
        total: { USD: usd, CNY: cny },
      },
    ],
  };
}

function dailyTrendObservation(
  usd: string,
  cny: string,
  capturedAt: string,
  complete: boolean,
): DailyAssetSnapshot {
  return {
    day: "2026-07-28",
    capturedAt,
    complete,
    total: { USD: usd, CNY: cny },
    sources: [
      {
        sourceId: "trend-source",
        label: "趋势来源",
        kind: "test",
        capturedAt,
        complete,
        total: { USD: usd, CNY: cny },
      },
    ],
  };
}

function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await ready;
  };
}

function memoryTransactionalSecrets(
  reference: string,
  arrive: () => Promise<void>,
) {
  const values = new Map<string, string>();
  return {
    async stage(value: string) {
      values.set(reference, value);
      await arrive();
      return reference;
    },
    async commit(target: string) {
      if (!values.has(target)) throw new Error("pending secret missing");
    },
    async put(value: string) {
      values.set(reference, value);
      return reference;
    },
    async get(target: string) {
      return values.get(target) ?? null;
    },
    async replace(target: string, value: string) {
      values.set(target, value);
    },
    async remove(target: string) {
      values.delete(target);
    },
  };
}

async function sqliteFilesContain(
  dataDirectory: string,
  needles: string[],
): Promise<boolean> {
  const names = ["dashboard.sqlite", "dashboard.sqlite-wal", "dashboard.sqlite-shm"];
  const buffers = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(
        /* turbopackIgnore: true */ dataDirectory,
        name,
      );
      return (await exists(filePath))
        ? readFile(/* turbopackIgnore: true */ filePath)
        : Buffer.alloc(0);
    }),
  );
  return needles.some((needle) =>
    buffers.some((buffer) => buffer.includes(Buffer.from(needle))),
  );
}

async function exerciseSqliteLockContention(
  databasePath: string,
): Promise<boolean> {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE concurrency_probe (id TEXT PRIMARY KEY) STRICT;
    BEGIN IMMEDIATE;
    INSERT INTO concurrency_probe (id) VALUES ('main');
  `);
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const worker = new Worker(
    `
      const { workerData, parentPort } = require("node:worker_threads");
      const { DatabaseSync } = require("node:sqlite");
      const state = new Int32Array(workerData.state);
      const database = new DatabaseSync(workerData.databasePath);
      database.exec("PRAGMA busy_timeout = 5000");
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      database.exec("BEGIN IMMEDIATE");
      database.prepare("INSERT INTO concurrency_probe (id) VALUES (?)").run("worker");
      database.exec("COMMIT");
      database.close();
      parentPort.postMessage("done");
    `,
    {
      eval: true,
      workerData: { databasePath, state: state.buffer },
    },
  );
  let workerDone = false;
  const completion = new Promise<void>((resolve, reject) => {
    worker.on("message", (message) => {
      if (message === "done") {
        workerDone = true;
        resolve();
      }
    });
    worker.on("error", reject);
  });
  try {
    while (Atomics.load(state, 0) === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const waitedForLock = !workerDone;
    database.exec("COMMIT");
    await completion;
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM concurrency_probe")
      .get() as { count: number };
    return waitedForLock && row.count === 2;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // 保留原始并发测试错误。
    }
    throw error;
  } finally {
    await worker.terminate();
    database.close();
  }
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const action = new URL(request.url).searchParams.get("action");
  if (
    action !== "empty-startup" &&
    action !== "json-import" &&
    action !== "repeat-import" &&
    action !== "connection-rollback" &&
    action !== "credential-commit-rollback" &&
    action !== "concurrent-writes" &&
    action !== "daily-idempotency" &&
    action !== "source-lifecycle" &&
    action !== "delete-middle-source" &&
    action !== "startup-failures" &&
    action !== "schema-v2-migration" &&
    action !== "schema-v4-trend-observation-migration" &&
    action !== "complete-trend-survives-incomplete-refresh" &&
    action !== "schema-v6-hkd-fx-migration" &&
    action !== "schema-v8-manual-source-migration" &&
    action !== "schema-v12-investment-cashflow-migration" &&
    action !== "display-name-persistence" &&
    action !== "evm-token-preference-persistence" &&
    action !== "evm-unrecognized-token-persistence" &&
    action !== "longbridge-option-read-upgrade" &&
    action !== "manual-source-record-persistence"
  ) {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const root = await mkdtemp(path.join(tmpdir(), "pad-sqlite-persistence-"));
  const dataDirectory = path.join(root, "data");
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  try {
    if (action === "manual-source-record-persistence") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const database = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      await database.createManualAssetSource(
        { label: "A股" },
        "2026-08-03T01:00:00.000Z",
      );
      const [unrecorded] = await database.listSources();
      const unrecordedBaselines = await database.listDailyAssetSnapshots();
      await database.recordManualAssetSource(
        unrecorded.id,
        { day: "2026-08-03", amount: "108000", currency: "CNY" },
        "2026-08-03T08:00:00.000Z",
      );
      await database.setAssetSourceManualClass(unrecorded.id, "securities");
      await database.createManualAssetSource(
        { label: "场外基金" },
        "2026-08-03T09:00:00.000Z",
      );
      const reloaded = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const sources = await reloaded.listSources();
      const baselines = await reloaded.listDailyAssetSnapshots();
      const trend = await reloaded.listDailyAssetTrendObservations();
      return Response.json({
        unrecorded: {
          hasManualRecord: unrecorded.hasManualRecord,
          dailySnapshots: unrecordedBaselines.length,
        },
        sources: sources.map((source) => ({
          label: source.label,
          hasManualRecord: source.hasManualRecord,
          manualAssetClass: source.manualAssetClass,
          total: source.snapshot.total,
        })),
        cards: (await reloaded.listAssetCards()).length,
        baselines: baselines.map((snapshot) => ({
          sources: snapshot.sources.map((source) => source.label),
          total: snapshot.total,
        })),
        trend: trend.map((snapshot) => ({
          sources: snapshot.sources.map((source) => source.label),
          total: snapshot.total,
        })),
      });
    }
    if (action === "schema-v8-manual-source-migration") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      const first = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      await first.connectBinance(
        authorization("schema-v8", "not-persisted-here"),
        "opaque-v8-reference",
        "2026-08-03T01:00:00.000Z",
      );
      const downgrade = new DatabaseSync(databasePath);
      downgrade.exec(`
        ALTER TABLE asset_sources DROP COLUMN has_manual_record;
        UPDATE schema_metadata SET value = '8' WHERE key = 'schema_version';
      `);
      downgrade.close();

      const migrated = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      await migrated.createManualAssetSource(
        { label: "A股" },
        "2026-08-03T02:00:00.000Z",
      );
      const [existing, manual] = await migrated.listSources();
      await migrated.recordManualAssetSource(
        manual.id,
        { day: "2026-08-03", amount: "108000", currency: "CNY" },
        "2026-08-03T08:00:00.000Z",
      );
      await migrated.setAssetSourceManualClass(manual.id, "securities");
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const schemaVersion = inspection
        .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
        .get() as { value: string };
      const columns = inspection
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      inspection.close();
      const sources = await migrated.listSources();
      return Response.json({
        schemaVersion: schemaVersion.value,
        hasManualRecordColumn: columns.some(
          ({ name }) => name === "has_manual_record",
        ),
        manualAssetClassColumn: columns.some(
          ({ name }) => name === "manual_asset_class",
        ),
        existing: {
          id: existing.id,
          label: existing.label,
        },
        manual: sources.find((source) => source.id === manual.id),
      });
    }
    if (action === "schema-v12-investment-cashflow-migration") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      const first = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const source = longbridgeReferenceSource();
      await first.replaceSources([source]);
      const snapshot = {
        ...dailySnapshot(source.id, "10000", "72000"),
        total: { USD: "10000", CNY: "72000", HKD: "78000" },
        exchangeRates: source.snapshot.exchangeRates,
        sources: [{
          ...dailySnapshot(source.id, "10000", "72000").sources[0],
          label: source.label,
          kind: source.kind,
          total: { USD: "10000", CNY: "72000", HKD: "78000" },
        }],
      };
      await first.createDailyAssetSnapshotIfAbsent(snapshot);
      const beforeSnapshots = await first.listDailyAssetSnapshots();

      const downgrade = new DatabaseSync(databasePath);
      downgrade.exec(`
        DROP TABLE investment_cashflows;
        UPDATE schema_metadata SET value = '12' WHERE key = 'schema_version';
      `);
      downgrade.close();

      const migrated = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const ledger = new InvestmentCashflowLedger(
        migrated,
        { list: () => migrated.listSources() },
        { now: () => new Date("2026-08-05T12:00:00.000Z") },
      );
      const cashflow = await ledger.create({
        kind: "initial-investment",
        occurredAt: "2026-08-01T00:00:00.000Z",
        amount: "10000",
        currency: "USD",
        note: "迁移后补录",
      });
      const afterSnapshots = await migrated.listDailyAssetSnapshots();
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const schemaVersion = inspection
        .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
        .get() as { value: string };
      const tables = inspection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'investment_cashflows'",
        )
        .all();
      inspection.close();
      return Response.json({
        schemaVersion: schemaVersion.value,
        cashflowTable: tables.length === 1,
        cashflow: {
          kind: cashflow.kind,
          occurredAt: cashflow.occurredAt,
          amount: cashflow.amount,
          currency: cashflow.currency,
          amounts: cashflow.amounts,
          exchangeRateSources: cashflow.exchangeRates.map(({ source }) => source),
        },
        snapshotsUnchanged:
          JSON.stringify(afterSnapshots) === JSON.stringify(beforeSnapshots),
      });
    }
    if (action === "schema-v2-migration") {
      await mkdir(dataDirectory, { recursive: true });
      new SqliteDashboardDatabase(
        path.join(dataDirectory, "dashboard.sqlite"),
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const downgrade = new DatabaseSync(databasePath);
      downgrade.exec(`
        ALTER TABLE asset_source_snapshots DROP COLUMN coverage_json;
        ALTER TABLE asset_sources DROP COLUMN display_name;
        ALTER TABLE asset_sources DROP COLUMN ignored_asset_keys_json;
        ALTER TABLE asset_sources DROP COLUMN included_asset_keys_json;
        UPDATE schema_metadata SET value = '2' WHERE key = 'schema_version';
      `);
      downgrade.close();

      const migrated = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const result = authorization("schema-v2", "not-persisted-here");
      result.snapshot.coverage = {
        status: "partial",
        products: [],
        unexplainedValue: { amount: "3", currency: "USD" },
        excludedPositiveAccounts: [],
      };
      await migrated.connectBinance(
        result,
        "opaque-v2-reference",
        "2026-07-28T02:00:00.000Z",
      );
      const [source] = await migrated.listSources();
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const schemaVersion = inspection
        .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
        .get() as { value: string };
      const columns = inspection
        .prepare("PRAGMA table_info(asset_source_snapshots)")
        .all() as Array<{ name: string }>;
      const sourceColumns = inspection
        .prepare("PRAGMA table_info(asset_sources)")
        .all() as Array<{ name: string }>;
      inspection.close();
      return Response.json({
        schemaVersion: schemaVersion.value,
        coverageColumn: columns.some(({ name }) => name === "coverage_json"),
        displayNameColumn: sourceColumns.some(
          ({ name }) => name === "display_name",
        ),
        coverageStatus: source.snapshot.coverage?.status,
        unexplainedValue: source.snapshot.coverage?.unexplainedValue,
      });
    }

    if (action === "schema-v4-trend-observation-migration") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      const first = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const initial = dailyTrendObservation(
        "10",
        "72",
        "2026-07-28T00:30:00.000Z",
        true,
      );
      await first.createDailyAssetSnapshotIfAbsent(initial);

      const downgrade = new DatabaseSync(databasePath);
      downgrade.exec(`
        DROP TABLE daily_asset_source_trend_observations;
        DROP TABLE daily_asset_trend_observations;
        ALTER TABLE asset_sources DROP COLUMN ignored_asset_keys_json;
        ALTER TABLE asset_sources DROP COLUMN included_asset_keys_json;
        UPDATE schema_metadata SET value = '4' WHERE key = 'schema_version';
      `);
      downgrade.close();

      const migrated = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const [migratedTrend] = await migrated.listDailyAssetTrendObservations();
      await migrated.recordDailyAssetObservation(
        dailyTrendObservation(
          "20",
          "144",
          "2026-07-28T02:30:00.000Z",
          true,
        ),
        true,
      );
      const [baseline] = await migrated.listDailyAssetSnapshots();
      const [trendAfterSuccess] = await migrated.listDailyAssetTrendObservations();
      await migrated.recordDailyAssetObservation(
        dailyTrendObservation(
          "20",
          "144",
          "2026-07-28T03:30:00.000Z",
          false,
        ),
        false,
      );

      const restarted = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const [trendAfterFailureAndRestart] =
        await restarted.listDailyAssetTrendObservations();
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const schemaVersion = inspection
        .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
        .get() as { value: string };
      inspection.close();
      const observation = (snapshot: DailyAssetSnapshot) => ({
        capturedAt: snapshot.capturedAt,
        complete: snapshot.complete,
        total: snapshot.total,
      });
      return Response.json({
        schemaVersion: schemaVersion.value,
        migratedTrend: observation(migratedTrend),
        baseline: observation(baseline),
        trendAfterSuccess: observation(trendAfterSuccess),
        trendAfterFailureAndRestart: {
          ...observation(trendAfterFailureAndRestart),
          source: observation({
            ...trendAfterFailureAndRestart,
            total: trendAfterFailureAndRestart.sources[0].total,
            capturedAt: trendAfterFailureAndRestart.sources[0].capturedAt,
            complete: trendAfterFailureAndRestart.sources[0].complete,
          }),
        },
      });
    }

    if (action === "complete-trend-survives-incomplete-refresh") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const database = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const complete = dailyTrendObservation(
        "100",
        "720",
        "2026-07-28T02:30:00.000Z",
        true,
      );
      complete.total.HKD = "780";
      complete.sources[0].total.HKD = "780";
      await database.recordDailyAssetObservation(complete, true);

      const incomplete = dailyTrendObservation(
        "80",
        "576",
        "2026-07-28T03:30:00.000Z",
        false,
      );
      incomplete.total.HKD = "624";
      incomplete.sources[0].total.HKD = "624";
      await database.recordDailyAssetObservation(incomplete, true);

      const restarted = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const [trend] = await restarted.listDailyAssetTrendObservations();
      return Response.json({
        capturedAt: trend.capturedAt,
        complete: trend.complete,
        status: trend.status,
        total: trend.total,
        source: {
          capturedAt: trend.sources[0].capturedAt,
          complete: trend.sources[0].complete,
          status: trend.sources[0].status,
          total: trend.sources[0].total,
        },
      });
    }

    if (action === "display-name-persistence") {
      const first = createProductionServices(dataDirectory);
      await first.secrets.get("startup-ready");
      await first.assetSourceConnections.connectBinance(
        authorization("persistence", "display-name-secret"),
      );
      const [connected] = await first.assetSources.list();
      await first.assetSourceLifecycle.setDisplayName(
        connected.id,
        "  长期账户  ",
      );

      const restarted = createProductionServices(dataDirectory);
      await restarted.secrets.get("startup-ready");
      const [renamedSource] = await restarted.assetSources.list();
      await restarted.assetSourceLifecycle.setDisplayName(
        renamedSource.id,
        "",
      );

      const restartedAfterClear = createProductionServices(dataDirectory);
      await restartedAfterClear.secrets.get("startup-ready");
      const [clearedSource] = await restartedAfterClear.assetSources.list();
      return Response.json({
        renamed: {
          displayName: renamedSource.displayName ?? null,
          label: renamedSource.label,
          accountId: renamedSource.accountId,
        },
        cleared: {
          displayName: clearedSource.displayName ?? null,
          label: clearedSource.label,
          accountId: clearedSource.accountId,
        },
      });
    }

    if (action === "evm-token-preference-persistence") {
      const assetKey =
        "evm:56:0xcccccccccccccccccccccccccccccccccccccccc";
      const first = createProductionServices(dataDirectory);
      await first.secrets.get("startup-ready");
      await first.assetSourceConnections.connectEvm(evmAuthorization());
      const [connected] = await first.assetSources.list();
      await first.assetSourceLifecycle.setEvmTokenPreference(
        connected.id,
        [assetKey],
        "ignored",
      );

      const restartedIgnored = createProductionServices(dataDirectory);
      await restartedIgnored.secrets.get("startup-ready");
      const [ignoredSource] = await restartedIgnored.assetSources.list();
      await restartedIgnored.assetSourceLifecycle.setEvmTokenPreference(
        ignoredSource.id,
        [assetKey],
        "included",
      );

      const restartedIncluded = createProductionServices(dataDirectory);
      await restartedIncluded.secrets.get("startup-ready");
      const [includedSource] = await restartedIncluded.assetSources.list();
      return Response.json({
        ignoredAfterRestart: {
          ignoredAssetKeys: ignoredSource.ignoredAssetKeys ?? [],
          includedAssetKeys: ignoredSource.includedAssetKeys ?? [],
        },
        includedAfterRestart: {
          ignoredAssetKeys: includedSource.ignoredAssetKeys ?? [],
          includedAssetKeys: includedSource.includedAssetKeys ?? [],
        },
      });
    }

    if (action === "evm-unrecognized-token-persistence") {
      const candidate = {
        sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
        symbol: "WstETH",
        name: "Lido: stETH Withdrawal NFT",
        quantity: null,
        reason: "代币合约未返回可靠 decimals，数量无法读取",
      };
      const authorization = evmAuthorization();
      authorization.snapshot = {
        ...authorization.snapshot,
        unrecognizedEvmTokens: [candidate],
      };
      const first = createProductionServices(dataDirectory);
      await first.secrets.get("startup-ready");
      await first.assetSourceConnections.connectEvm(authorization);

      const restarted = createProductionServices(dataDirectory);
      await restarted.secrets.get("startup-ready");
      const [source] = await restarted.assetSources.list();
      return Response.json({
        unrecognizedEvmTokens: source.snapshot.unrecognizedEvmTokens ?? [],
      });
    }

    if (action === "longbridge-option-read-upgrade") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const database = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      await database.replaceSources([legacyLongbridgeOptionSource()]);

      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const raw = inspection
        .prepare("SELECT holdings_json FROM asset_source_snapshots")
        .get() as { holdings_json: string };
      inspection.close();

      const restarted = new SqliteDashboardDatabase(
        databasePath,
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      const [source] = await restarted.listSources();
      return Response.json({
        rawStatus: JSON.parse(raw.holdings_json)[0].valuation.status,
        readStatus: source.snapshot.holdings[0].valuation.status,
        total: source.snapshot.total,
      });
    }

    if (action === "schema-v6-hkd-fx-migration") {
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const downgrade = new DatabaseSync(databasePath);
      downgrade.exec(`
        ALTER TABLE daily_asset_snapshots DROP COLUMN exchange_rates_json;
        ALTER TABLE daily_asset_snapshots DROP COLUMN total_hkd;
        ALTER TABLE daily_asset_source_snapshots DROP COLUMN total_hkd;
        ALTER TABLE daily_asset_trend_observations DROP COLUMN exchange_rates_json;
        ALTER TABLE daily_asset_trend_observations DROP COLUMN total_hkd;
        ALTER TABLE daily_asset_source_trend_observations DROP COLUMN total_hkd;
        ALTER TABLE asset_sources DROP COLUMN ignored_asset_keys_json;
        ALTER TABLE asset_sources DROP COLUMN included_asset_keys_json;
        UPDATE schema_metadata SET value = '6' WHERE key = 'schema_version';
      `);
      downgrade.close();

      const database = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const baseline = {
        ...dailySnapshot("source-one", "10", "72"),
        total: { USD: "10", CNY: "72", HKD: "78" },
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "基准人民币汇率",
          observedAt: "2026-07-28T02:00:00.000Z",
        }, {
          baseCurrency: "HKD",
          quoteCurrency: "USD",
          rate: "0.1282051282051282",
          source: "基准港币汇率",
          observedAt: "2026-07-28T02:00:00.000Z",
        }],
        sources: [{
          ...dailySnapshot("source-one", "10", "72").sources[0],
          total: { USD: "10", CNY: "72", HKD: "78" },
        }],
      };
      await database.createDailyAssetSnapshotIfAbsent(baseline);
      const trend = {
        ...baseline,
        capturedAt: "2026-07-28T03:00:00.000Z",
        total: { USD: "11", CNY: "79.2", HKD: "85.8" },
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "趋势人民币汇率",
          observedAt: "2026-07-28T03:00:00.000Z",
        }, {
          baseCurrency: "USD",
          quoteCurrency: "HKD",
          rate: "7.8",
          source: "趋势港币汇率",
          observedAt: "2026-07-28T03:00:00.000Z",
        }],
        sources: [{
          ...baseline.sources[0],
          capturedAt: "2026-07-28T03:00:00.000Z",
          total: { USD: "11", CNY: "79.2", HKD: "85.8" },
        }],
      };
      await database.recordDailyAssetObservation(trend, true);
      const reloaded = new SqliteDashboardDatabase(
        databasePath,
        legacyDashboardPath,
        legacyCardsPath,
      );
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      const hkdColumns = [
        "daily_asset_snapshots",
        "daily_asset_source_snapshots",
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
      ].every((table) =>
        (inspection.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
        }>).some(({ name }) => name === "total_hkd"),
      );
      const schemaVersion = inspection
        .prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'")
        .get() as { value: string };
      inspection.close();
      const [reloadedBaseline] = await reloaded.listDailyAssetSnapshots();
      const [reloadedTrend] = await reloaded.listDailyAssetTrendObservations();
      return Response.json({
        schemaVersion: schemaVersion.value,
        hkdColumns,
        baseline: {
          total: reloadedBaseline.total,
          exchangeRates: reloadedBaseline.exchangeRates?.map(
            ({ baseCurrency, quoteCurrency, rate }) => ({
              baseCurrency,
              quoteCurrency,
              rate,
            }),
          ),
        },
        trend: {
          total: reloadedTrend.total,
          exchangeRates: reloadedTrend.exchangeRates?.map(
            ({ baseCurrency, quoteCurrency, rate }) => ({
              baseCurrency,
              quoteCurrency,
              rate,
            }),
          ),
        },
      });
    }

    if (action === "json-import" || action === "repeat-import") {
      const legacyContents = await writeLegacyDashboard(dataDirectory);
      const first = createProductionServices(dataDirectory);
      await first.secrets.get("startup-ready");
      if (action === "repeat-import") {
        const changed = legacyDashboard();
        changed.assetCards = [];
        changed.assetSources = [];
        changed.dailyAssetSnapshots = [];
        await writeFile(
          path.join(dataDirectory, "dashboard.json"),
          JSON.stringify(changed),
        );
        const restarted = createProductionServices(dataDirectory);
        await restarted.secrets.get("startup-ready");
        return Response.json({
          cardIds: (await restarted.assetCards.list()).map(({ id }) => id),
          sourceIds: (await restarted.assetSources.list()).map(({ id }) => id),
        });
      }

      const [card] = await first.assetCards.list();
      const [source] = await first.assetSources.list();
      const [dailySnapshot] = await first.dailyAssetSnapshots.list();
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const backupPath = path.join(
        dataDirectory,
        "dashboard.json.migration-backup",
      );
      return Response.json({
        card,
        source: {
          id: source.id,
          credentialReference: source.credentialReference,
          lifecycle: source.lifecycle,
          holdings: source.snapshot.holdings,
          coverage: source.snapshot.coverage,
        },
        dailySnapshot: {
          day: dailySnapshot.day,
          total: dailySnapshot.total,
          sourceIds: dailySnapshot.sources.map(({ sourceId }) => sourceId),
        },
        databaseMode: displayMode((await stat(databasePath)).mode),
        backupMode: displayMode((await stat(backupPath)).mode),
        backupMatches: (await readFile(backupPath, "utf8")) === legacyContents,
      });
    }

    if (action === "startup-failures") {
      const corruptDirectory = path.join(root, "corrupt");
      const invalidJsonDirectory = path.join(root, "invalid-json");
      await mkdir(corruptDirectory, { recursive: true });
      const corruptPath = path.join(corruptDirectory, "dashboard.sqlite");
      const corruptContents = Buffer.from("not-a-sqlite-database");
      await writeFile(corruptPath, corruptContents);
      let corruptError = "";
      try {
        createProductionServices(corruptDirectory);
      } catch (error) {
        corruptError = error instanceof Error ? error.message : String(error);
      }

      await mkdir(invalidJsonDirectory, { recursive: true });
      const invalidJsonPath = path.join(invalidJsonDirectory, "dashboard.json");
      const invalidJsonContents = "{invalid-json";
      await writeFile(invalidJsonPath, invalidJsonContents);
      let invalidJsonError = "";
      try {
        createProductionServices(invalidJsonDirectory);
      } catch (error) {
        invalidJsonError = error instanceof Error ? error.message : String(error);
      }
      return Response.json({
        corruptDatabaseRejected: corruptError.length > 0,
        corruptDatabasePreserved:
          Buffer.compare(await readFile(corruptPath), corruptContents) === 0,
        invalidJsonRejected: invalidJsonError.length > 0,
        invalidJsonPreserved:
          (await readFile(invalidJsonPath, "utf8")) === invalidJsonContents,
        recoverableErrors:
          corruptError.includes("已停止启动") &&
          invalidJsonError.includes("已停止启动"),
      });
    }

    if (action === "connection-rollback") {
      const credentials = "rollback-api-secret";
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      let rejected = false;
      try {
        await services.assetSourceConnections.connectBinance(
          authorization("rollback", credentials, true),
        );
      } catch {
        rejected = true;
      }
      return Response.json({
        rejected,
        cards: (await services.assetCards.list()).length,
        sources: (await services.assetSources.list()).length,
        dailySnapshots: (await services.dailyAssetSnapshots.list()).length,
        rawSecretLeaked: await sqliteFilesContain(dataDirectory, [credentials]),
      });
    }

    if (action === "credential-commit-rollback") {
      await mkdir(dataDirectory, { recursive: true });
      const database = new SqliteDashboardDatabase(
        path.join(dataDirectory, "dashboard.sqlite"),
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      let pendingSecret = true;
      const failingSecrets = {
        async stage() {
          return "pending-reference";
        },
        async commit() {
          throw new Error("credential commit failed");
        },
        async put() {
          throw new Error("not used");
        },
        async get() {
          return null;
        },
        async replace() {},
        async remove() {
          pendingSecret = false;
        },
      };
      const connections = new DatabaseAssetSourceConnections(
        database,
        failingSecrets,
        Promise.resolve(),
        { now: () => new Date("2026-07-28T02:00:00.000Z") },
      );
      let rejected = false;
      try {
        await connections.connectBinance(
          authorization("commit-failure", "commit-failure-secret"),
        );
      } catch {
        rejected = true;
      }
      return Response.json({
        rejected,
        pendingSecretRemoved: !pendingSecret,
        cards: (await database.listAssetCards()).length,
        sources: (await database.listSources()).length,
        dailySnapshots: (await database.listDailyAssetSnapshots()).length,
      });
    }

    if (action === "concurrent-writes") {
      const credentials = ["concurrent-secret-one", "concurrent-secret-two"];
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      const databases = [
        new SqliteDashboardDatabase(
          databasePath,
          legacyDashboardPath,
          legacyCardsPath,
        ),
        new SqliteDashboardDatabase(
          databasePath,
          legacyDashboardPath,
          legacyCardsPath,
        ),
      ];
      const arrive = twoPartyBarrier();
      const connections = databases.map(
        (database, index) =>
          new DatabaseAssetSourceConnections(
            database,
            memoryTransactionalSecrets(`reference-${index}`, arrive),
            Promise.resolve(),
            { now: () => new Date("2026-07-28T02:00:00.000Z") },
          ),
      );
      await Promise.all([
        connections[0].connectBinance(
          authorization("concurrent-one", credentials[0]),
        ),
        connections[1].connectBinance(
          authorization("concurrent-two", credentials[1]),
        ),
      ]);
      const sources = await databases[0].listSources();
      const cards = await databases[0].listAssetCards();
      const dailySnapshots = await databases[0].listDailyAssetSnapshots();
      const trendObservations =
        await databases[0].listDailyAssetTrendObservations();
      return Response.json({
        accountIds: sources.map(({ accountId }) => accountId).sort(),
        cardCount: cards.length,
        dailySnapshotCount: dailySnapshots.length,
        dailySourceCount: dailySnapshots[0]?.sources.length ?? 0,
        trendSourceCount: trendObservations[0]?.sources.length ?? 0,
        lockContentionHandled: await exerciseSqliteLockContention(databasePath),
        rawSecretLeaked: await sqliteFilesContain(dataDirectory, credentials),
      });
    }

    if (action === "daily-idempotency") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      const results = [
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-one", "10", "72"),
        ),
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-one", "999", "999"),
        ),
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-two", "20", "144"),
        ),
      ];
      await services.dailyAssetSnapshots.record(
        dailySnapshot("source-two", "20", "144"),
        true,
      );
      const snapshots = await services.dailyAssetSnapshots.list();
      const trendObservations =
        await services.dailyAssetSnapshots.listTrendObservations();
      return Response.json({
        results,
        days: snapshots.map(({ day }) => day),
        sourceIds: snapshots[0].sources.map(({ sourceId }) => sourceId),
        total: snapshots[0].total,
        trend: {
          sourceIds: trendObservations[0].sources.map(({ sourceId }) => sourceId),
          total: trendObservations[0].total,
        },
      });
    }

    if (action === "source-lifecycle") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      await services.assetSourceConnections.connectBinance(
        authorization("lifecycle", "lifecycle-secret"),
      );
      const [connected] = await services.assetSources.list();
      await services.assetSourceLifecycle.setHidden(connected.id, true);
      await services.assetSourceLifecycle.disconnect(connected.id);
      const [disconnectedSource] = await services.assetSources.list();
      const [disconnectedCard] = await services.assetCards.list();
      const [retainedDailySnapshot] = await services.dailyAssetSnapshots.list();
      const [retainedTrendObservation] =
        await services.dailyAssetSnapshots.listTrendObservations();
      const disconnected = {
        lifecycle: disconnectedSource.lifecycle,
        hidden: disconnectedCard.hidden,
        sourceCount: (await services.assetSources.list()).length,
        dailySourceCount: retainedDailySnapshot.sources.length,
        trendSourceCount: retainedTrendObservation.sources.length,
        secretRemoved:
          connected.credentialReference !== null &&
          (await services.secrets.get(connected.credentialReference)) === null,
      };
      await services.assetSourceLifecycle.deleteData(connected.id);
      return Response.json({
        disconnected,
        deleted: {
          sourceCount: (await services.assetSources.list()).length,
          cardCount: (await services.assetCards.list()).length,
          dailySnapshotCount: (await services.dailyAssetSnapshots.list()).length,
          dailyTrendObservationCount: (
            await services.dailyAssetSnapshots.listTrendObservations()
          ).length,
        },
      });
    }

    if (action === "delete-middle-source") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      for (const accountId of ["first", "second", "third"]) {
        await services.assetSourceConnections.connectBinance(
          authorization(accountId, `${accountId}-secret`),
        );
      }
      const sources = await services.assetSources.list();
      await services.assetSourceLifecycle.deleteData(sources[1].id);
      await services.assetSourceConnections.connectBinance(
        authorization("fourth", "fourth-secret"),
      );
      return Response.json({
        accountIds: (await services.assetSources.list())
          .map(({ accountId }) => accountId)
          .sort(),
        cardCount: (await services.assetCards.list()).length,
      });
    }

    const services = createProductionServices(dataDirectory);
    await services.secrets.get("startup-ready");
    return Response.json({
      cards: await services.assetCards.list(),
      sources: await services.assetSources.list(),
      dailySnapshots: await services.dailyAssetSnapshots.list(),
      sqliteExists: await exists(path.join(dataDirectory, "dashboard.sqlite")),
      dashboardJsonExists: await exists(path.join(dataDirectory, "dashboard.json")),
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
