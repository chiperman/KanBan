import assert from "node:assert/strict";
import test from "node:test";

import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import type {
  AssetSourceSummary,
  InvestmentCashflow,
} from "@/server/ports";

class MemoryCashflows {
  records: InvestmentCashflow[] = [];

  async listInvestmentCashflows() {
    return structuredClone(this.records);
  }

  async createInvestmentCashflow(record: InvestmentCashflow) {
    this.records.push(structuredClone(record));
  }

  async updateInvestmentCashflow(record: InvestmentCashflow) {
    this.records = this.records.map((item) =>
      item.id === record.id ? structuredClone(record) : item,
    );
  }

  async deleteInvestmentCashflow(id: string) {
    this.records = this.records.filter((item) => item.id !== id);
  }
}

const longbridgeSource = {
  id: "longbridge",
  kind: "longbridge",
  label: "长桥",
  accountId: "longbridge:owner",
  permissions: ["account", "positions"],
  credentialReference: "opaque",
  snapshot: {
    total: { amount: "100", currency: "USD" },
    holdings: [],
    exchangeRates: [{
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.2",
      source: "Longbridge",
      observedAt: "2026-08-05T00:00:00.000Z",
    }, {
      baseCurrency: "USD",
      quoteCurrency: "HKD",
      rate: "7.8",
      source: "Longbridge",
      observedAt: "2026-08-05T00:00:00.000Z",
    }],
    syncedAt: "2026-08-05T00:00:00.000Z",
  },
  sync: {
    status: "current" as const,
    lastSuccessfulAt: "2026-08-05T00:00:00.000Z",
    lastAttemptAt: "2026-08-05T00:00:00.000Z",
    error: null,
  },
} satisfies AssetSourceSummary;

test("账本服务只允许最早的唯一初始投入，并保留创建时的长桥汇率证据", async () => {
  const store = new MemoryCashflows();
  const ledger = new InvestmentCashflowLedger(
    store,
    { list: async () => [longbridgeSource] },
    { now: () => new Date("2026-08-05T12:00:00.000Z") },
  );

  const initial = await ledger.create({
    kind: "initial-investment",
    occurredAt: "2026-08-01T00:00:00.000Z",
    amount: "10000",
    currency: "USD",
    note: "起始本金",
  });
  assert.deepEqual(initial.amounts, {
    USD: "10000",
    CNY: "72000",
    HKD: "78000",
  });

  await assert.rejects(
    () => ledger.create({
      kind: "initial-investment",
      occurredAt: "2026-08-02T00:00:00.000Z",
      amount: "2000",
      currency: "USD",
      note: null,
    }),
    /初始投入只能保留一条/,
  );
  await assert.rejects(
    () => ledger.create({
      kind: "external-deposit",
      occurredAt: "2026-08-06T00:00:00.000Z",
      amount: "2000",
      currency: "USD",
      note: null,
    }),
    /不能晚于当前时间/,
  );

  await ledger.update(initial.id, { note: "补充备注" });
  const [updated] = await ledger.list();
  assert.equal(updated.note, "补充备注");
  assert.equal(updated.amounts.CNY, "72000");
  assert.equal(updated.exchangeRates[0]?.observedAt, "2026-08-05T00:00:00.000Z");
});
