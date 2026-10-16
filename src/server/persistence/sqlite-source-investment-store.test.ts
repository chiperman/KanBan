import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteDashboardDatabase } from "./sqlite-database";

test("来源投资记录与历史写入失败回滚原数据，重试仍保持来源隔离", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-investment-transaction-"));
  const database = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const sql = (database as unknown as { database: DatabaseSync }).database;
  const prepare = sql.prepare.bind(sql);
  const capturedAt = "2026-10-01T01:00:00.000Z";
  try {
    await database.createManualAssetSource({ label: "A股" }, capturedAt);
    await database.createManualAssetSource({ label: "其他" }, capturedAt);
    const [source, other] = await database.listSources();
    const sources = await database.listSources();
    const record = {
      id: "local-deposit", day: "2026-09-01", kind: "deposit" as const,
      amount: "10", currency: "CNY" as const,
    };
    await database.saveSourceInvestmentRecord(source.id, record, capturedAt);
    const history = {
      sourceId: source.id, sourceLabel: source.label,
      provider: "external-ledger", accountId: "fixture", accountName: "A股",
      currency: "CNY", openingInvestment: { day: "2026-01-01", amount: "0" },
      openingBasis: "账本起点", importedAt: capturedAt,
      records: [
        { id: "deposit", day: "2026-01-01", kind: "deposit", amount: "10" },
        { id: "valuation", day: "2026-01-02", kind: "valuation", amount: "10" },
      ],
      reconciliation: { asOf: "2026-01-02", netInvestment: "10", total: "10", profit: "0" },
    };
    const operations = [
      {
        query: "INSERT INTO source_investment_records",
        run: () => database.saveSourceInvestmentRecord(source.id, { ...record, amount: "20" }, capturedAt),
      },
      {
        query: "INSERT INTO asset_source_investment_histories",
        run: () => database.importSourceInvestmentHistory(history),
      },
    ];
    for (const operation of operations) {
      const records = await database.listSourceInvestmentRecords();
      const histories = await database.listSourceInvestmentHistories();
      sql.prepare = ((query: string) => {
        const statement = prepare(query);
        if (!query.startsWith(operation.query)) return statement;
        return new Proxy(statement, {
          get(target, key) {
            if (key !== "run") return Reflect.get(target, key);
            return (...args: Parameters<typeof statement.run>) => {
              target.run(...args);
              throw new Error("fixture write failure");
            };
          },
        });
      }) as typeof sql.prepare;
      await assert.rejects(operation.run(), /fixture write failure/);
      sql.prepare = prepare;
      assert.deepEqual(await database.listSourceInvestmentRecords(), records);
      assert.deepEqual(await database.listSourceInvestmentHistories(), histories);
      await operation.run();
      assert.deepEqual(await database.listSourceInvestmentRecords(other.id), []);
      assert.equal((await database.readSourceDetail({ sourceId: other.id })).investmentHistory, null);
    }
    assert.equal((await database.listSourceInvestmentRecords(source.id))[0].amount, "20");
    assert.equal((await database.listSourceInvestmentHistories()).length, 1);
    assert.deepEqual(await database.listSources(), sources);
    assert.deepEqual(await database.listInvestmentCashflows(), []);
    assert.deepEqual(await database.listDailyAssetTrendObservations(), []);
  } finally {
    sql.prepare = prepare;
    sql.close();
    await rm(root, { recursive: true, force: true });
  }
});
