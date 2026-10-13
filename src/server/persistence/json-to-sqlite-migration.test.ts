import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { migrateJsonToSqlite } from "./json-to-sqlite-migration";
import { SqliteDashboardDatabase } from "./sqlite-database";
import type { AssetSourceSummary } from "@/server/ports";

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

test("一次性 JSON 迁移保留八种来源，并在非法类型时拒绝整份迁移且不落盘", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-json-kinds-"));
  const dashboardPath = path.join(root, "dashboard.json");
  const cardsPath = path.join(root, "cards.json");
  const databasePath = path.join(root, "dashboard.sqlite");
  const kinds = ["longbridge", "binance", "okx", "bitget", "bit",
    "evm-watch-ethereum", "evm-watch-bsc", "manual"] as const;
  const at = "2026-10-13T00:00:00.000Z";
  const assetSources: AssetSourceSummary[] = kinds.map(kind => ({
    id: kind, kind, label: kind, accountId: kind, permissions: [],
    credentialReference: kind === "manual" ? null : "fixture-reference",
    snapshot: { total: { amount: "0", currency: "USD" }, holdings: [], exchangeRates: [], syncedAt: at },
    sync: { status: "current", lastSuccessfulAt: at, lastAttemptAt: at, error: null },
  }));
  const dashboard = { schemaVersion: 9, assetCards: [], assetSources };
  try {
    for (const kind of ["unknown-provider", "constructor", "evm-watch-solana", null, 1, ["manual"]]) {
      const contents = JSON.stringify({ ...dashboard, assetSources: [
        ...assetSources, { ...assetSources[0], id: "invalid", kind },
      ] });
      await writeFile(dashboardPath, contents);
      await assert.rejects(migrateJsonToSqlite({ databasePath, dashboardPath, cardsPath }), /资产来源类型无效或不受支持/);
      assert.equal(await readFile(dashboardPath, "utf8"), contents);
      await assert.rejects(readFile(databasePath), { code: "ENOENT" });
      await assert.rejects(readFile(`${dashboardPath}.migration-backup`), { code: "ENOENT" });
    }
    const contents = JSON.stringify(dashboard);
    await writeFile(dashboardPath, contents);
    assert.deepEqual(await migrateJsonToSqlite({ databasePath, dashboardPath, cardsPath }), {
      sourceCount: 8, cardCount: 0, snapshotCount: 0,
    });
    const database = new SqliteDashboardDatabase(databasePath);
    try {
      assert.deepEqual((await database.listSources()).map(({ kind }) => kind), kinds);
    } finally { database.close(); }
    assert.equal(await readFile(dashboardPath, "utf8"), contents);
    assert.equal(await readFile(`${dashboardPath}.migration-backup`, "utf8"), contents);
  } finally { await rm(root, { recursive: true, force: true }); }
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
