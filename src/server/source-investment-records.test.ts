import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseSourceInvestmentRecordInput } from "../domain/source-investment-records";
import { SqliteDashboardDatabase } from "./persistence/sqlite-database";
import { CredentialFreeBusinessDataBackup } from "./backup/business-data-backup";

const at = "2026-09-29T12:00:00.000Z";
const record = (id: string, day: string, kind: "opening" | "deposit" | "withdrawal" | "valuation", amount: string) =>
  ({ id, day, kind, amount, currency: "CNY" as const });

test("来源投资记录四类、金额日期约束、幂等、隔离、刷新保留与备份恢复", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-source-records-"));
  const make = (name: string) => new SqliteDashboardDatabase(path.join(root, name + ".sqlite"));
  const db = make("original"), restored = make("restored");
  try {
    await db.createManualAssetSource({ label: "A股" }, at);
    await db.createManualAssetSource({ label: "其他" }, at);
    const [a, b] = await db.listSources();
    const save = (sourceId: string, input: ReturnType<typeof record>, capturedAt = at) => db.saveSourceInvestmentRecord(sourceId, input, capturedAt);
    for (const bad of [record("bad", "2026-02-30", "deposit", "1"), record("bad", "2026-09-30", "deposit", "1"), record("bad", "2026-09-01", "deposit", "0"), record("bad", "2026-09-01", "withdrawal", "0")]) {
      assert.throws(() => parseSourceInvestmentRecordInput(bad, at));
    }
    await save(a.id, record("d1", "2026-09-02", "deposit", "100"));
    await assert.rejects(save(a.id, record("late", "2026-09-03", "opening", "0")), /期初/);
    await save(a.id, record("open", "2026-09-01", "opening", "0"));
    await assert.rejects(save(a.id, record("open2", "2026-09-01", "opening", "1")), /期初/);
    await assert.rejects(save(a.id, record("open", "2026-09-03", "opening", "0")), /期初/);
    await assert.rejects(save(a.id, record("early", "2026-08-31", "deposit", "1")), /早于期初/);
    await save(a.id, record("d2", "2026-09-02", "deposit", "20"));
    await save(a.id, record("w", "2026-09-03", "withdrawal", "5"));
    await save(a.id, record("v", "2026-09-03", "valuation", "0"));
    await assert.rejects(save(a.id, record("v2", "2026-09-03", "valuation", "1")), /同日/);
    await assert.rejects(save(b.id, record("d1", "2026-09-02", "deposit", "1")), /其他来源/);
    await assert.rejects(db.saveSourceInvestmentRecord(a.id, { ...record("wrong", "2026-09-03", "deposit", "1"), currency: "USD" }, at), /币种/);
    await save(a.id, record("d1", "2026-09-02", "deposit", "100"), "2026-09-29T13:00:00Z");
    assert.equal((await db.listSourceInvestmentRecords(a.id)).find(row => row.id === "d1")?.recordedAt, at);
    await save(a.id, record("d1", "2026-09-02", "deposit", "101"));
    assert.equal((await db.listSourceInvestmentRecords(a.id)).find(row => row.id === "d1")?.amount, "101");
    await save(a.id, record("open", "2026-09-01", "withdrawal", "1"));
    assert.equal((await db.listSourceInvestmentRecords(a.id)).filter(row => row.kind === "opening").length, 0, "编辑期初为流水可留下无期初状态");
    await save(a.id, record("open", "2026-09-01", "opening", "0"));
    await assert.rejects(db.deleteSourceInvestmentRecord(b.id, "d1"), /不存在/);
    assert.equal((await db.readSourceDetail({ sourceId: a.id, from: "2026-09-29" })).investmentRecords.length, 5);
    await db.updateSource({ ...a, snapshot: { ...a.snapshot, total: { amount: "999", currency: "CNY" } } });
    assert.equal((await db.listSourceInvestmentRecords(a.id)).length, 5, "当前快照刷新不覆盖手工记录");
    const backups = new CredentialFreeBusinessDataBackup(db, root, { now: () => new Date(at) });
    await backups.exportBackup("current.json");
    await new CredentialFreeBusinessDataBackup(restored, root, { now: () => new Date(at) }).restore("current.json");
    assert.deepEqual(await restored.listSourceInvestmentRecords(), await db.listSourceInvestmentRecords());
    const old = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
    old.formatVersion = 6; delete old.payload.sourceInvestmentRecords;
    old.checksum.value = createHash("sha256").update(JSON.stringify({ format: old.format, formatVersion: 6, createdAt: old.createdAt, payload: old.payload })).digest("hex");
    await writeFile(path.join(root, "old.json"), JSON.stringify(old));
    const preview = await backups.previewRestore("old.json");
    assert.equal(preview.omittedHistory?.sourceInvestmentRecords, 5);
    await assert.rejects(backups.restore("old.json"), /丢弃/);
    await db.deleteSourceInvestmentRecord(a.id, "w");
    assert.equal((await db.listSourceInvestmentRecords(a.id)).length, 4);
    await restored.deleteAssetSourceData(a.id);
    assert.equal((await restored.listSourceInvestmentRecords()).length, 0);
  } finally {
    for (const item of [db, restored]) (item as unknown as { database: DatabaseSync }).database.close();
    await rm(root, { recursive: true, force: true });
  }
});
