import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";
import { CredentialFreeBusinessDataBackup } from "../business-data-backup";
import type { SourceInvestmentHistory } from "@/domain/source-investment-history";

const at = "2026-10-18T08:00:00.000Z";
const history: SourceInvestmentHistory = {
  sourceId: "external-a", sourceLabel: "A股", provider: "external-ledger", accountId: "a", accountName: "A股", currency: "CNY",
  openingInvestment: { day: "2026-10-01", amount: "0" }, openingBasis: "零起点", importedAt: at,
  records: [
    { id: "deposit", kind: "deposit", day: "2026-10-01", amount: "100" },
    { id: "value", kind: "valuation", day: "2026-10-11", amount: "110" },
  ], reconciliation: { asOf: "2026-10-11", total: "110", netInvestment: "100", profit: "10" },
};

test("三本账事务记账、重复导入、更正作废审计、失败回滚及备份恢复", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-books-"));
  const db = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const restored = new SqliteDashboardDatabase(path.join(root, "restore.sqlite"));
  const backup = new CredentialFreeBusinessDataBackup(db, root, { now: () => new Date(at) });
  try {
    await backup.exportBackup("before.json");
    assert.equal(await db.readStoredInvestmentBooks(), undefined, "备份本身不触发迁移");
    await db.readInvestmentBooks();
    for (const [bookId, currency] of [["us-stocks", "USD"], ["a-shares", "CNY"], ["crypto", "USD"]] as const) {
      const row = { id: bookId, day: "2026-10-12", kind: "deposit", amount: "20", currency };
      await db.saveBookRecord(bookId, row, at);
      await db.saveBookRecord(bookId, row, at);
      await db.saveBookRecord(bookId, { ...row, id: `${bookId}-out`, kind: "withdrawal", amount: "5" }, at);
    }
    const beforeImport = await db.readInvestmentBooks();
    assert.equal(beforeImport.records.length, 6);
    await db.importBookHistory("a-shares", history);
    await db.importBookHistory("a-shares", history);
    const imported = await db.readInvestmentBooks();
    assert.equal(imported.records.length, 9);
    assert.equal(imported.imports.length, 1);
    assert.deepEqual(await db.listInvestmentCashflows(), [], "不再写一份全局资金");
    await assert.rejects(db.saveBookRecord("crypto", { id: "wrong", day: "2026-10-12", kind: "deposit", amount: "1", currency: "CNY" }, at), /USD/);
    await assert.rejects(db.importBookHistory("us-stocks", history), /币种/);
    const modified = structuredClone(history);
    modified.records[0].amount = "101";
    modified.reconciliation.netInvestment = "101";
    modified.reconciliation.profit = "9";
    await assert.rejects(db.importBookHistory("a-shares", modified), /改写/);
    assert.deepEqual(await db.readInvestmentBooks(), imported);
    const old = imported.records.find(row => row.kind === "valuation")!;
    await db.saveBookRecord("a-shares", { id: "correction", replacesId: old.id, day: old.day, kind: old.kind, amount: "112", currency: "CNY" }, at);
    await db.voidBookRecord("a-shares", "a-shares-out", at);
    const corrected = await db.readInvestmentBooks();
    assert.equal(corrected.records.find(row => row.id === old.id)?.amount, "110");
    assert.ok(corrected.records.find(row => row.id === old.id)?.voidedAt);
    assert.equal(corrected.records.find(row => row.id === "correction")?.amount, "112");
    await db.importBookHistory("a-shares", history);
    assert.deepEqual(await db.readInvestmentBooks(), corrected, "再次导入不会复活更正前原件");
    await assert.rejects(db.saveBookRecord("a-shares", { id: "invalid", replacesId: "a-shares", day: "2026-10-12", kind: "opening", amount: "1", currency: "CNY" }, at), /类型/);
    assert.deepEqual(await db.readInvestmentBooks(), corrected, "失败操作整体回滚");
    await backup.exportBackup("after.json");
    await new CredentialFreeBusinessDataBackup(restored, root, { now: () => new Date(at) }).restore("after.json");
    assert.deepEqual(await restored.readStoredInvestmentBooks(), corrected);
    const preview = await backup.previewRestore("before.json");
    assert.ok(preview.omittedHistory?.investmentBookRecords);
    await assert.rejects(backup.restore("before.json"), /明确确认/);
    await db.saveBookRecord("crypto", { id: "later", day: "2026-10-18", kind: "deposit", amount: "1", currency: "USD" }, at);
    await assert.rejects(backup.restore("before.json", preview.discardConfirmation), /明确确认/);
    const document = JSON.parse(await readFile(path.join(root, "after.json"), "utf8"));
    document.payload.investmentBooks.records.find((row: { id: string }) => row.id === old.id).amount = "999";
    const { format, formatVersion, createdAt, payload } = document;
    document.checksum.value = createHash("sha256").update(JSON.stringify({ format, formatVersion, createdAt, payload })).digest("hex");
    await writeFile(path.join(root, "tampered.json"), JSON.stringify(document), { mode: 0o600 });
    await assert.rejects(backup.previewRestore("tampered.json"), /原件与账本/);
    await assert.rejects(restored.replaceBusinessData({ ...payload }), /原件与账本/);
    assert.deepEqual(await restored.readStoredInvestmentBooks(), corrected, "直接恢复失败不破坏原数据");
  } finally {
    db.close(); restored.close();
    await rm(root, { recursive: true, force: true });
  }
});
