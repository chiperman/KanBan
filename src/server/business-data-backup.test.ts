import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import type { SqliteDashboardDatabase as DashboardDatabase } from "@/server/production";
import type { FormalDailySettlement } from "@/server/ports";
import {
  CredentialFreeBusinessDataBackup,
  type BusinessDataBackupStore,
  type BusinessDataState,
} from "@/server/business-data-backup";

// 原生 ESM 不补全 Next 子路径，仅在加载真实持久化实现时适配。
const nextHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
  },
});
const { SqliteDashboardDatabase } = await import("@/server/production");
nextHook.deregister();

const observation = {
  sourceId: "source-test", label: "测试来源", kind: "longbridge",
  day: "2026-08-01", capturedAt: "2026-08-01T12:00:00.000Z",
  complete: true, status: "complete" as const,
  total: { USD: "0", CNY: "0", HKD: null },
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-backup-validation-"));
  let restored: BusinessDataState | null = null;
  const store: BusinessDataBackupStore = {
    listAssetCards: async () => [],
    listSources: async () => [{
      id: "source-test", label: "测试来源", kind: "longbridge",
      accountId: "test-owner", permissions: [], credentialReference: null,
      snapshot: { total: { amount: "0", currency: "USD" }, holdings: [], exchangeRates: [],
        syncedAt: observation.capturedAt },
      sync: {
        status: "current", lastSuccessfulAt: observation.capturedAt,
        lastAttemptAt: observation.capturedAt, error: null,
        diagnostic: {
          stage: "response", category: "rate-limit", httpStatus: 429,
          code: "429", durationMs: 12, retryable: true,
        },
        recentAttempts: [{
          attemptedAt: observation.capturedAt, mode: "all", attempt: 1,
          outcome: "failure", durationMs: 12,
          diagnostic: {
            stage: "response", category: "rate-limit", httpStatus: 429,
            code: "429", durationMs: 12, retryable: true,
          },
        }],
        unsafeRawError: "must not be exported",
      } as unknown as BusinessDataState["assetSources"][number]["sync"],
    }],
    listDailyAssetSnapshots: async () => [],
    listDailyAssetTrendObservations: async () => [],
    listImportedSourceHistoryObservations: async () => [observation],
    listInvestmentCashflows: async () => [],
    listManualAssetRecords: async () => [],
    listFormalDailySettlements: async () => [],
    validateBusinessData: async () => {},
    replaceBusinessData: async (state) => { restored = state; },
  };
  const backup = new CredentialFreeBusinessDataBackup(store, directory,
    { now: () => new Date("2026-08-02T00:00:00.000Z") });
  await backup.exportBackup("valid.json");
  const document = JSON.parse(await readFile(path.join(directory, "valid.json"), "utf8"));
  async function rewrite() {
    const { format, formatVersion, createdAt, payload } = document;
    document.checksum.value = createHash("sha256")
      .update(JSON.stringify({ format, formatVersion, createdAt, payload })).digest("hex");
    await writeFile(path.join(directory, "candidate.json"), JSON.stringify(document));
  }
  return { directory, backup, document, rewrite, restored: () => restored };
}

test("备份完整保留来源历史和零金额，旧版缺失字段兼容为空", async () => {
  const f = await fixture();
  try {
    await f.backup.restore("valid.json");
    assert.deepEqual(f.restored()?.importedAssetSourceHistoryObservations, [observation]);
    f.document.formatVersion = 3;
    delete f.document.payload.importedAssetSourceHistoryObservations;
    await f.rewrite();
    await f.backup.restore("candidate.json");
    assert.deepEqual(f.restored()?.importedAssetSourceHistoryObservations, []);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("备份往返保留可选同步诊断与最近尝试，并丢弃非白名单字段", async () => {
  const f = await fixture();
  try {
    const exported = JSON.parse(await readFile(path.join(f.directory, "valid.json"), "utf8"));
    const sync = exported.payload.assetSources[0].sync;
    assert.equal(sync.diagnostic.category, "rate-limit");
    assert.equal(sync.recentAttempts.length, 1);
    assert.equal("unsafeRawError" in sync, false);
    await f.backup.restore("valid.json");
    const restored = f.restored()!.assetSources[0].sync;
    assert.equal(restored.diagnostic?.httpStatus, 429);
    assert.equal(restored.recentAttempts?.[0].outcome, "failure");
    assert.equal(restored.error, "已从备份恢复，需重新授权后才能同步");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("来源历史恢复拒绝无效字段、重复日期和悬空引用，失败不替换业务数据", async () => {
  const invalid: unknown[] = [
    undefined, {}, [null],
    [{ ...observation, day: "2026-02-30" }],
    [{ ...observation, capturedAt: "2026-02-30T12:00:00Z" }],
    [{ ...observation, complete: "true" }],
    [{ ...observation, status: "unknown" }],
    [{ ...observation, complete: false }],
    [{ ...observation, total: { USD: "NaN", CNY: "0" } }],
    [{ ...observation, total: { USD: "-1", CNY: "0" } }],
    [{ ...observation, sourceId: "missing" }],
    [observation, observation],
  ];
  for (const value of invalid) {
    const f = await fixture();
    try {
      f.document.payload.importedAssetSourceHistoryObservations = value;
      await f.rewrite();
      await assert.rejects(f.backup.restore("candidate.json"), /备份/);
      assert.equal(f.restored(), null);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
});

async function readBusinessState(database: DashboardDatabase): Promise<BusinessDataState> {
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

async function sqliteFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-backup-sqlite-"));
  const databasePath = path.join(directory, "business.sqlite");
  const database = new SqliteDashboardDatabase(databasePath,
    path.join(directory, "absent-dashboard.json"), path.join(directory, "absent-cards.json"));
  const sql = new DatabaseSync(databasePath);
  const time = "2026-08-03T12:00:00.000Z";
  await database.createManualAssetSource({ label: "测试多日原始记录" }, time);
  const source = (await database.listSources())[0];
  await database.updateSource({ ...source, snapshot: { ...source.snapshot, exchangeRates: [
    { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "Longbridge", observedAt: time },
    { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "Longbridge", observedAt: time },
  ] } });
  for (const day of ["2026-08-01", "2026-08-02"]) {
    await database.recordManualAssetSource(source.id, { day, amount: day.endsWith("01") ? "0" : "123.45", currency: "USD" }, time);
  }
  for (const trend of await database.listDailyAssetTrendObservations()) {
    await database.createDailyAssetSnapshotIfAbsent(trend);
  }
  // 独立种子写入不依赖待修复的 replaceBusinessData。
  sql.prepare("INSERT INTO imported_asset_source_history_observations (source_id, day, label, kind, captured_at, complete, status, total_usd, total_cny, total_hkd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(source.id, "2026-07-31", source.label, source.kind, time, 0, "incomplete", "0", null, null);
  await database.createInvestmentCashflow({
    id: "initial", kind: "initial-investment", occurredAt: "2026-08-01T00:00:00.000Z",
    amount: "100", currency: "USD", note: "测试本金",
    amounts: { USD: "100", CNY: "720", HKD: null },
    exchangeRates: [{ baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "Longbridge", observedAt: time }],
    createdAt: time, updatedAt: time,
  });
  for (const day of ["2026-08-01", "2026-08-02"]) {
    const settlement: FormalDailySettlement = {
      anchor: { key: "crypto-cutoff:" + day, kind: "crypto-cutoff", market: null, tradingDay: day, scheduledCloseAt: day + "T16:00:00.000Z" },
      capturedAt: time, status: "incomplete", diagnostic: "缺少港币汇率",
      total: { USD: "0", CNY: null, HKD: null },
      exchangeRates: [{ baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "Longbridge", observedAt: time }],
      sources: [{ sourceId: source.id, label: source.label, kind: source.kind,
        capturedAt: time, status: "incomplete", diagnostic: "缺少汇率", total: { USD: "0", CNY: null, HKD: null } }],
      holdings: [{ sourceId: source.id, sourceAsset: "test-cash", symbol: "USD", name: "测试现金", quantity: "0",
        assetClass: "cash", price: { amount: "1", currency: "USD" }, priceBasis: "capture-time",
        priceObservedAt: time, market: null, marketTradingDay: null, marketValue: "0", diagnostic: null }],
    };
    await database.recordFormalDailySettlementIfAbsent(settlement);
  }
  const backup = new CredentialFreeBusinessDataBackup(database, directory, { now: () => new Date(time) });
  return { directory, database, sql, backup,
    async close() {
      sql.close();
      (database as unknown as { database: DatabaseSync }).database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("真实 SQLite 全业务替换保留多日手工原始记录和正式日结子数据", async () => {
  const f = await sqliteFixture();
  try {
    const before = await readBusinessState(f.database);
    for (const [name, records] of Object.entries(before)) assert.ok(records.length > 0, name);
    assert.equal(before.manualAssetRecords.length, 2);
    assert.equal(before.formalDailySettlements.length, 2);
    const exported = await f.backup.exportBackup("roundtrip.json");
    assert.equal(exported.warning.includes("敏感资产数据"), true);
    await f.database.replaceBusinessData({
      assetCards: [], assetSources: [], dailyAssetSnapshots: [],
      dailyAssetTrendObservations: [], importedAssetSourceHistoryObservations: [],
      investmentCashflows: [], manualAssetRecords: [], formalDailySettlements: [],
    });
    await f.backup.restore(exported.fileName);
    assert.deepEqual(await f.database.listManualAssetRecords(), before.manualAssetRecords);
    assert.deepEqual(await f.database.listFormalDailySettlements(), before.formalDailySettlements);
    assert.deepEqual(await readBusinessState(f.database), before);
  } finally { await f.close(); }
});

test("损坏备份和恢复中途失败都不覆盖原 SQLite", async () => {
  const f = await sqliteFixture();
  try {
    const before = await readBusinessState(f.database);
    await f.backup.exportBackup("corrupt.json");
    const corruptPath = path.join(f.directory, "corrupt.json");
    const corrupt = JSON.parse(await readFile(corruptPath, "utf8"));
    corrupt.checksum.value = "0".repeat(64);
    await writeFile(corruptPath, JSON.stringify(corrupt));
    await assert.rejects(f.backup.restore("corrupt.json"), /校验和/);
    assert.deepEqual(await readBusinessState(f.database), before);

    const triggerConnection = new DatabaseSync(path.join(f.directory, "business.sqlite"));
    triggerConnection.exec(`
      CREATE TRIGGER reject_restored_holding
      BEFORE INSERT ON formal_daily_settlement_holdings
      BEGIN SELECT RAISE(ABORT, 'simulated restore failure'); END;
    `);
    try {
      await assert.rejects(f.database.replaceBusinessData(before), /simulated restore failure/);
    } finally {
      triggerConnection.exec("DROP TRIGGER reject_restored_holding");
      triggerConnection.close();
    }
    assert.deepEqual(await readBusinessState(f.database), before);
  } finally { await f.close(); }
});

test("业务备份排除运维执行记录，恢复业务数据也不改写最近执行", async () => {
  const f = await sqliteFixture();
  try {
    const execution = {
      startedAt: "2026-09-18T00:05:00.000Z", finishedAt: "2026-09-18T00:05:01.000Z",
      outcome: "error" as const, reason: "source-read-failed" as const, settlementStatus: null,
    };
    await f.database.recordFormalSettlementExecution(execution);
    await f.backup.exportBackup("without-operations.json");
    const raw = await readFile(path.join(f.directory, "without-operations.json"), "utf8");
    assert.ok(!raw.includes("source-read-failed"));
    const payload = JSON.parse(raw).payload;
    assert.deepEqual(Object.keys(payload).sort(), [
      "assetCards", "assetSources", "dailyAssetSnapshots", "dailyAssetTrendObservations",
      "formalDailySettlements", "importedAssetSourceHistoryObservations", "investmentCashflows", "manualAssetRecords",
      "sourceInvestmentHistories", "sourceInvestmentRecords",
    ].sort());
    await f.backup.restore("without-operations.json");
    assert.deepEqual(await f.database.latestFormalSettlementExecution(), execution);
  } finally { await f.close(); }
});

for (const version of [1, 2, 3, 4]) {
  test("旧版本 " + version + " 默认保护已有历史并绑定显式丢弃确认", async () => {
    const f = await sqliteFixture();
    try {
      await f.backup.exportBackup("legacy.json");
      const file = path.join(f.directory, "legacy.json");
      const document = JSON.parse(await readFile(file, "utf8"));
      document.formatVersion = version;
      delete document.payload.manualAssetRecords;
      delete document.payload.formalDailySettlements;
      if (version < 4) delete document.payload.importedAssetSourceHistoryObservations;
      if (version === 1) {
        document.data = { cards: document.payload.assetCards, sources: document.payload.assetSources, snapshots: document.payload.dailyAssetSnapshots };
        delete document.payload;
      }
      const base = { format: document.format, formatVersion: version, createdAt: document.createdAt,
        ...(version === 1 ? { data: document.data } : { payload: document.payload }) };
      document.checksum.value = createHash("sha256").update(JSON.stringify(base)).digest("hex");
      await writeFile(file, JSON.stringify(document));
      const before = await readBusinessState(f.database);
      const preview = await f.backup.previewRestore("legacy.json");
      assert.deepEqual(preview.omittedHistory, { manualAssetRecords: 2, formalDailySettlements: 2 });
      assert.deepEqual(await readBusinessState(f.database), before);
      await assert.rejects(f.backup.restore("legacy.json"), /明确确认/);
      await assert.rejects(f.backup.restore("legacy.json", "invalid"), /明确确认/);
      assert.deepEqual(await readBusinessState(f.database), before);
      await f.backup.restore("legacy.json", preview.discardConfirmation);
      assert.deepEqual(await f.database.listFormalDailySettlements(), []);
    } finally { await f.close(); }
  });
}

test("恢复后手工记录仍可编辑，同日唯一，删除最新值回退", async () => {
  const f = await sqliteFixture();
  try {
    await f.backup.exportBackup("editable.json");
    await f.backup.restore("editable.json");
    await f.backup.restore("editable.json");
    const [source] = await f.database.listSources();
    await f.database.recordManualAssetSource(source.id, {day:"2026-08-02",amount:"99",currency:"USD"}, "2026-08-03T12:00:00.000Z");
    assert.equal((await f.database.listManualAssetRecords()).length, 2);
    assert.equal((await f.database.listSources())[0].snapshot.total.amount, "99");
    await f.database.deleteManualAssetSourceRecord(source.id, "2026-08-02", "2026-08-03T12:00:00.000Z");
    assert.equal((await f.database.listSources())[0].snapshot.total.amount, "0");
    assert.equal((await f.database.listManualAssetRecords()).length, 1);
  } finally { await f.close(); }
});
