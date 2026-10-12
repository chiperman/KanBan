import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { migrateJsonToSqlite } from "./json-to-sqlite-migration";
import { SqliteDashboardDatabase } from "./sqlite-database";

test("一次性 JSON 迁移写入 SQLite 并保留旧文件备份", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-json-migration-"));
  const dashboardPath = path.join(root, "dashboard.json");
  const cardsPath = path.join(root, "cards.json");
  const databasePath = path.join(root, "dashboard.sqlite");
  const dashboard = {
    schemaVersion: 9,
    assetCards: [{ id: "card", kind: "asset", title: "旧卡片", body: "正文", span: 1 }],
    assetSources: [],
  };
  const contents = JSON.stringify(dashboard);
  try {
    await writeFile(dashboardPath, contents);
    const result = await migrateJsonToSqlite({ databasePath, dashboardPath, cardsPath });
    assert.deepEqual(result, { sourceCount: 0, cardCount: 1, snapshotCount: 0 });
    assert.equal(await readFile(`${dashboardPath}.migration-backup`, "utf8"), contents);

    const database = new SqliteDashboardDatabase(databasePath);
    try {
      assert.deepEqual((await database.listAssetCards()).map(({ id }) => id), ["card"]);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JSON 迁移拒绝覆盖已有 SQLite 业务数据", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-json-migration-nonempty-"));
  const dashboardPath = path.join(root, "dashboard.json");
  const cardsPath = path.join(root, "cards.json");
  const databasePath = path.join(root, "dashboard.sqlite");
  try {
    await writeFile(dashboardPath, JSON.stringify({
      schemaVersion: 9,
      assetCards: [],
      assetSources: [],
    }));
    const database = new SqliteDashboardDatabase(databasePath);
    await database.createManualAssetSource({ label: "已有来源" }, "2026-10-13T00:00:00.000Z");
    database.close();
    await assert.rejects(
      migrateJsonToSqlite({ databasePath, dashboardPath, cardsPath }),
      /目标 SQLite 已包含业务数据/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
