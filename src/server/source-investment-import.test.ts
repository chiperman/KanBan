import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteDashboardDatabase } from "./persistence/sqlite-database";
import { CredentialFreeBusinessDataBackup } from "./business-data-backup";
import { parseSourceInvestmentHistory } from "../domain/source-investment-history";

test("来源历史事务导入、身份隔离、幂等与备份恢复", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-source-import-"));
  const make = (name: string) => new SqliteDashboardDatabase(path.join(root, name + ".sqlite"), path.join(root, "absent.json"), path.join(root, "absent-cards.json"));
  const database = make("original"); const restored = make("restored");
  try {
    await database.createManualAssetSource({ label: "A股" }, "2026-01-01T00:00:00Z");
    await database.createManualAssetSource({ label: "长桥" }, "2026-01-01T00:00:00Z");
    const [aShare, other] = await database.listSources();
    const beforeSources = await database.listSources();
    const history = parseSourceInvestmentHistory({
      sourceId: aShare.id, sourceLabel: "A股", provider: "youzhiyouxing", accountId: "a-share-account", accountName: "大A账户", currency: "CNY",
      openingInvestment: {day:"2026-01-01",amount:"100"}, openingBasis:"用户确认", importedAt:"2026-01-11T12:00:00Z",
      records:[{id:"v1",day:"2026-01-01",kind:"valuation",amount:"100"},{id:"d1",day:"2026-01-06",kind:"deposit",amount:"100"},{id:"v2",day:"2026-01-11",kind:"valuation",amount:"180"}],
      reconciliation:{asOf:"2026-01-11",netInvestment:"200",total:"180",profit:"-20"},
    });
    assert.deepEqual(await database.importSourceInvestmentHistory(history), {imported:true, records:3});
    assert.deepEqual(await database.importSourceInvestmentHistory(history), {imported:false, records:3});
    assert.deepEqual(await database.listSources(), beforeSources, "不改写任何当前资产或长桥记录");
    assert.deepEqual(await database.listInvestmentCashflows(), [], "不写组合资金账本");
    assert.deepEqual(await database.listDailyAssetTrendObservations(), [], "不补造组合历史");
    assert.equal((await database.readSourceDetail({sourceId:other.id})).investmentHistory, null);
    assert.deepEqual((await database.readSourceDetail({sourceId:aShare.id,from:"2026-01-10"})).investmentHistory, history, "区间筛选不能遗漏期初本金");
    await assert.rejects(database.importSourceInvestmentHistory({...history,sourceId:other.id}), /身份不匹配/);
    await assert.rejects(database.importSourceInvestmentHistory({...history,accountId:"wrong-account"}), /账户/);
    const edited = structuredClone(history); edited.records[0].amount = "90";
    await assert.rejects(database.importSourceInvestmentHistory(edited), /冲突/);
    assert.deepEqual(await database.listSourceInvestmentHistories(), [history]);

    const clock = { now: () => new Date("2026-01-12T00:00:00Z") };
    const backups = new CredentialFreeBusinessDataBackup(database, root, clock);
    await backups.exportBackup("history.json");
    const legacy = JSON.parse(await readFile(path.join(root, "history.json"), "utf8"));
    legacy.formatVersion = 5;
    delete legacy.payload.sourceInvestmentHistories;
    legacy.checksum.value = createHash("sha256").update(JSON.stringify({format:legacy.format,formatVersion:5,createdAt:legacy.createdAt,payload:legacy.payload})).digest("hex");
    await writeFile(path.join(root, "legacy.json"), JSON.stringify(legacy), {mode:0o600});
    const preview = await backups.previewRestore("legacy.json");
    assert.equal(preview.omittedHistory?.sourceInvestmentHistories, 1);
    assert.ok(preview.discardConfirmation);
    await assert.rejects(backups.restore("legacy.json"), /丢弃/);
    assert.deepEqual(await database.listSourceInvestmentHistories(), [history]);
    const restore = new CredentialFreeBusinessDataBackup(restored, root, clock);
    await restore.restore("history.json");
    assert.deepEqual(await restored.listSourceInvestmentHistories(), [history]);
    await restored.deleteAssetSourceData(aShare.id);
    assert.deepEqual(await restored.listSourceInvestmentHistories(), [], "删除来源时级联清理独立历史");
  } finally {
    for (const db of [database,restored]) (db as unknown as {database:DatabaseSync}).database.close();
    await rm(root,{recursive:true,force:true});
  }
});

test("长桥有知有行历史允许导入及备份恢复，零期初与首次投入各计一次", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-longbridge-import-"));
  const make = (name: string) => new SqliteDashboardDatabase(path.join(root, name + ".sqlite"), path.join(root, "absent.json"), path.join(root, "absent-cards.json"));
  const database = make("original"), restored = make("restored");
  try {
    await database.connectLongbridge({
      credentials: "test-reference", permissions: ["account", "positions"], account: { id: "lb-account", label: "长桥" },
      snapshot: { total: { amount: "1200", currency: "CNY" }, holdings: [], exchangeRates: [], syncedAt: "2026-09-29T00:00:00Z" },
    }, "test-reference", "2026-09-29T00:00:00Z");
    const source = (await database.listSources())[0];
    const history = parseSourceInvestmentHistory({
      sourceId: source.id, sourceLabel: source.label, provider: "youzhiyouxing", accountId: "yz-lb", accountName: "长桥", currency: "CNY",
      openingInvestment: { day: "2024-04-20", amount: "0" }, openingBasis: "账本起点", importedAt: "2026-09-29T01:00:00Z",
      records: [
        { id: "first-deposit", day: "2024-04-20", kind: "deposit", amount: "1275" },
        { id: "value", day: "2024-04-21", kind: "valuation", amount: "1200" },
      ],
      reconciliation: { asOf: "2024-04-21", netInvestment: "1275", total: "1200", profit: "-75" },
    });
    await assert.rejects(database.importSourceInvestmentHistory({ ...history, sourceLabel: "别的来源" }), /身份不匹配/);
    assert.deepEqual(await database.importSourceInvestmentHistory(history), { imported: true, records: 2 });
    assert.deepEqual(await database.importSourceInvestmentHistory(history), { imported: false, records: 2 });
    await assert.rejects(database.saveSourceInvestmentRecord(source.id, { id: "opening", day: "2024-04-20", kind: "opening", amount: "0", currency: "CNY" }, "2026-09-29T12:00:00Z"), /期初/);
    await assert.rejects(database.saveSourceInvestmentRecord(source.id, { id: "early", day: "2024-04-19", kind: "deposit", amount: "1", currency: "CNY" }, "2026-09-29T12:00:00Z"), /早于导入历史期初/);
    await database.saveSourceInvestmentRecord(source.id, { id: "first-local", day: "2024-04-20", kind: "deposit", amount: "2", currency: "CNY" }, "2026-09-29T12:00:00Z");
    await database.saveSourceInvestmentRecord(source.id, { id: "local", day: "2026-09-28", kind: "valuation", amount: "1300", currency: "CNY" }, "2026-09-29T12:00:00Z");
    await assert.rejects(database.saveSourceInvestmentRecord(source.id, { id: "local", day: "2024-04-19", kind: "valuation", amount: "1300", currency: "CNY" }, "2026-09-29T12:00:00Z"), /早于导入历史期初/);
    assert.equal((await database.listSourceInvestmentRecords(source.id)).find(row => row.id === "local")?.day, "2026-09-28");
    const backup = new CredentialFreeBusinessDataBackup(database, root, { now: () => new Date("2026-09-29T12:00:00Z") });
    await backup.exportBackup("longbridge.json");
    await new CredentialFreeBusinessDataBackup(restored, root, { now: () => new Date("2026-09-29T12:00:00Z") }).restore("longbridge.json");
    assert.deepEqual(await restored.listSourceInvestmentHistories(), [history]);
    assert.deepEqual(await restored.listSourceInvestmentRecords(source.id), await database.listSourceInvestmentRecords(source.id));
  } finally {
    for (const db of [database, restored]) (db as unknown as { database: DatabaseSync }).database.close();
    await rm(root, { recursive: true, force: true });
  }
});
