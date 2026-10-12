import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";
import { SqliteInvestmentReadStore } from "./sqlite-investment-read-store";
import { SqliteObservationReadStore } from "./sqlite-observation-read-store";
import { SqliteSourceReadStore } from "./sqlite-source-read-store";

test("SQLite 只读职责模块保持来源、观测、资金查询口径", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-read-model-"));
  const database = new SqliteDashboardDatabase(
    path.join(root, "data.sqlite"),
    path.join(root, "absent.json"),
    path.join(root, "absent-cards.json"),
  );
  const sql = (database as unknown as { database: DatabaseSync }).database;
  const capturedAt = "2026-10-01T01:00:00.000Z";
  try {
    await database.createManualAssetSource({ label: "测试来源" }, capturedAt);
    const source = (await database.listSources())[0];
    await database.recordManualAssetSource(
      source.id,
      { day: "2026-10-01", amount: "100", currency: "USD" },
      capturedAt,
    );
    await database.saveSourceInvestmentRecord(
      source.id,
      { id: "deposit", day: "2026-10-01", kind: "deposit", amount: "100", currency: "USD" },
      capturedAt,
    );
    await database.createInvestmentCashflow({
      id: "initial",
      kind: "initial-investment",
      occurredAt: capturedAt,
      amount: "100",
      currency: "USD",
      note: null,
      amounts: { USD: "100", CNY: null, HKD: null },
      exchangeRates: [],
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });

    const sourceReads = new SqliteSourceReadStore(sql);
    const observationReads = new SqliteObservationReadStore(sql);
    const investmentReads = new SqliteInvestmentReadStore(sql);
    assert.deepEqual(sourceReads.listSourcesSync(), await database.listSources());
    assert.deepEqual(sourceReads.listManualAssetRecordsSync(), await database.listManualAssetRecords());
    assert.deepEqual(observationReads.listDailyAssetSnapshotsSync(), await database.listDailyAssetSnapshots());
    assert.deepEqual(
      observationReads.listDailyAssetTrendObservationsSync(),
      await database.listDailyAssetTrendObservations(),
    );
    assert.deepEqual(investmentReads.listInvestmentCashflowsSync(), await database.listInvestmentCashflows());
    assert.deepEqual(
      investmentReads.listSourceInvestmentRecordsSync(source.id),
      await database.listSourceInvestmentRecords(source.id),
    );
  } finally {
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});
