import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";

async function fixture(
  run: (database: SqliteDashboardDatabase, sql: DatabaseSync) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-refresh-state-"));
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

test("刷新元数据支持首次初始化、在途租约、过期重占与按批次完成", async () => {
  await fixture(async (database) => {
    assert.deepEqual(await database.readAssetFullRefreshState(), {
      attemptedAt: null,
      inProgressAt: null,
    });
    assert.equal(
      await database.initializeAssetFullRefresh("2026-10-01T00:00:00.000Z"),
      true,
    );
    assert.equal(
      await database.initializeAssetFullRefresh("2026-10-01T00:01:00.000Z"),
      false,
    );
    await database.startAssetFullRefresh("2026-10-01T00:00:00.000Z");
    assert.equal(
      await database.claimAssetFullRefresh({
        attemptedAt: "2026-10-01T00:00:30.000Z",
        intervalMs: 60_000,
        staleAfterMs: 120_000,
        force: false,
      }),
      "in-progress",
    );
    await database.finishAssetFullRefresh("wrong-batch");
    assert.equal(
      (await database.readAssetFullRefreshState()).inProgressAt,
      "2026-10-01T00:00:00.000Z",
    );
    await database.finishAssetFullRefresh("2026-10-01T00:00:00.000Z");
    assert.equal((await database.readAssetFullRefreshState()).inProgressAt, null);
    assert.equal(
      await database.claimAssetFullRefresh({
        attemptedAt: "2026-10-01T00:00:30.000Z",
        intervalMs: 60_000,
        staleAfterMs: 120_000,
        force: false,
      }),
      "not-due",
    );
    assert.equal(
      await database.claimAssetFullRefresh({
        attemptedAt: "2026-10-01T00:02:00.000Z",
        intervalMs: 60_000,
        staleAfterMs: 120_000,
        force: true,
      }),
      "claimed",
    );
    await database.finishAssetFullRefresh("2026-10-01T00:00:00.000Z");
    assert.equal((await database.readAssetFullRefreshState()).inProgressAt, "2026-10-01T00:02:00.000Z");
    await database.finishAssetFullRefresh("2026-10-01T00:02:00.000Z");
    assert.equal((await database.readAssetFullRefreshState()).inProgressAt, null);
  });
});

test("刷新元数据写入失败时整个租约变更回滚，既有诊断保持不变", async () => {
  await fixture(async (database, sql) => {
    await database.startAssetFullRefresh("2026-10-01T00:00:00.000Z");
    const before = await database.readAssetFullRefreshState();
    sql.exec(`CREATE TRIGGER reject_refresh_metadata_update
      BEFORE INSERT ON schema_metadata
      BEGIN SELECT RAISE(ABORT, 'fixture refresh metadata failure'); END;`);
    await assert.rejects(
      database.startAssetFullRefresh("2026-10-01T00:05:00.000Z"),
      /fixture refresh metadata failure/,
    );
    assert.deepEqual(await database.readAssetFullRefreshState(), before);
    sql.exec("DROP TRIGGER reject_refresh_metadata_update");
    await database.startAssetFullRefresh("2026-10-01T00:05:00.000Z");
    assert.deepEqual(await database.readAssetFullRefreshState(), {
      attemptedAt: "2026-10-01T00:05:00.000Z",
      inProgressAt: "2026-10-01T00:05:00.000Z",
    });
  });
});

test("清除刷新状态同时移除尝试和在途元数据", async () => {
  await fixture(async (database) => {
    await database.startAssetFullRefresh("2026-10-01T00:00:00.000Z");
    await database.clearAssetFullRefresh();
    assert.deepEqual(await database.readAssetFullRefreshState(), {
      attemptedAt: null,
      inProgressAt: null,
    });
  });
});

test("业务迁移完成标记由元数据模块写入且只导入一次", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-metadata-import-"));
  const databasePath = path.join(root, "data.sqlite");
  const dashboardPath = path.join(root, "dashboard.json");
  const cardsPath = path.join(root, "cards.json");
  const dashboard = {
    schemaVersion: 9,
    assetCards: [{ id: "legacy-card", kind: "asset", title: "旧卡片", body: "正文", span: 2 }],
    assetSources: [],
  };
  await writeFile(dashboardPath, JSON.stringify(dashboard));
  let database = new SqliteDashboardDatabase(databasePath, dashboardPath, cardsPath);
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    assert.equal(sql.prepare("SELECT value FROM schema_metadata WHERE key = 'json_import_complete'").get()?.value, "1");
    assert.equal(await readFile(dashboardPath + ".migration-backup", "utf8"), JSON.stringify(dashboard));
    assert.equal((await database.listAssetCards()).length, 1);
    sql.close();
    database = new SqliteDashboardDatabase(databasePath, dashboardPath, cardsPath);
    assert.equal((await database.listAssetCards()).length, 1);
    const reopened = new DatabaseSync(databasePath);
    reopened.prepare("DELETE FROM schema_metadata WHERE key = 'json_import_complete'").run();
    reopened.close();
    await writeFile(dashboardPath, JSON.stringify({ ...dashboard, assetCards: [] }));
    assert.throws(
      () => new SqliteDashboardDatabase(databasePath, dashboardPath, cardsPath),
      /迁移备份与旧 Dashboard 不一致/,
    );
  } finally {
    try { (database as unknown as { database: DatabaseSync }).database.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});
