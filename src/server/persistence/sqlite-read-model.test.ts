import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";
import type { AssetSourceSummary } from "@/server/ports";

test("SQLite 列表与详情读取保留全部受支持来源类型", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-source-kinds-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const at = "2026-10-13T00:00:00.000Z";
  const kinds = ["longbridge", "binance", "okx", "bitget", "bit",
    "evm-watch-ethereum", "evm-watch-bsc", "manual"] as const;
  const sources: AssetSourceSummary[] = kinds.map((kind) => ({
    id: kind, kind, label: kind, accountId: kind, permissions: [],
    credentialReference: kind === "manual" ? null : "fixture-reference",
    snapshot: { total: { amount: "0", currency: "USD" }, holdings: [],
      exchangeRates: [], syncedAt: at },
    sync: { status: "current", lastSuccessfulAt: at, lastAttemptAt: at, error: null },
  }));
  try {
    await database.replaceSources(sources);
    assert.deepEqual((await database.listSources()).map(({ kind }) => kind), kinds);
    const detail = await database.readSourceDetail({ sourceId: "evm-watch-bsc" });
    assert.deepEqual(detail.sources.map(({ kind }) => kind), kinds);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite 读取拒绝未知来源而不改写原始数据", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-source-kind-invalid-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const sql = (database as unknown as { database: DatabaseSync }).database;
  try {
    await database.createManualAssetSource({ label: "保留原数据" }, "2026-10-13T00:00:00.000Z");
    const [source] = await database.listSources();
    for (const kind of ["unknown-provider", "__proto__", "constructor"]) {
      sql.prepare("UPDATE asset_sources SET kind = ? WHERE id = ?").run(kind, source.id);
      await assert.rejects(database.listSources(), /资产来源类型无效或不受支持/);
      await assert.rejects(database.readSourceDetail({ sourceId: source.id }), /资产来源类型无效或不受支持/);
      assert.equal(sql.prepare("SELECT kind FROM asset_sources WHERE id = ?").get(source.id)?.kind, kind);
    }
    sql.prepare("UPDATE asset_sources SET kind = ? WHERE id = ?").run("manual", source.id);
    assert.deepEqual(await database.listSources(), [source]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
