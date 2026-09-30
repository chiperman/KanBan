import assert from "node:assert/strict";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseSourceInvestmentHistory, analyzeSourceInvestmentHistory } from "../src/domain/source-investment-history";
import { SqliteDashboardDatabase } from "../src/server/persistence/sqlite-database";

const [databaseFile, inputFile, action] = process.argv.slice(2);
if (!databaseFile || !inputFile || (action !== undefined && action !== "--apply")) {
  throw new Error("用法：node --experimental-transform-types --import ./scripts/register-ts-alias.mjs scripts/import-source-investment-history.ts <数据库> <记录JSON> [--apply]");
}
const history = parseSourceInvestmentHistory(JSON.parse(await readFile(inputFile, "utf8")));
const sql = new DatabaseSync(databaseFile, { readOnly: true });
const source = sql.prepare("SELECT kind, label FROM asset_sources WHERE id = ?").get(history.sourceId);
assert.ok(source?.kind === "manual" || source?.kind === "longbridge", "目标必须为手工来源或长桥账户");
assert.equal(source?.label, history.sourceLabel, "目标名称必须匹配");
const ledgerBefore = sql.prepare("SELECT * FROM investment_cashflows ORDER BY id").all();
const manualBefore = sql.prepare("SELECT * FROM manual_asset_records ORDER BY source_id, day").all();
let backupPath: string | null = null;
let result = null;
if (action === "--apply") {
  backupPath = path.join(path.dirname(inputFile), `before-import-${Date.now()}.sqlite`);
  await backup(sql, backupPath);
  await chmod(backupPath, 0o600);
  const directory = path.dirname(databaseFile);
  const database = new SqliteDashboardDatabase(databaseFile, path.join(directory, "dashboard.json"), path.join(directory, "cards.json"));
  result = await database.importSourceInvestmentHistory(history);
  assert.deepEqual(sql.prepare("SELECT * FROM investment_cashflows ORDER BY id").all(), ledgerBefore, "组合及长桥资金账本必须不变");
  assert.deepEqual(sql.prepare("SELECT * FROM manual_asset_records ORDER BY source_id, day").all(), manualBefore, "已有手工记录必须不变");
  assert.deepEqual((await database.readSourceDetail({sourceId:history.sourceId})).investmentHistory, history);
}
sql.close();
console.log(JSON.stringify({ applied: action === "--apply", source: history.sourceLabel, account: history.accountName,
  records: history.records.length, valuations: history.records.filter(row => row.kind === "valuation").length,
  deposits: history.records.filter(row => row.kind === "deposit").length, withdrawals: history.records.filter(row => row.kind === "withdrawal").length,
  reconciliation: analyzeSourceInvestmentHistory(history, [], history.reconciliation.asOf).current,
  backupPath, result }, null, 2));
