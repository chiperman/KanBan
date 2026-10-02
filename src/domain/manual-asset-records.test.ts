import assert from "node:assert/strict";
import test from "node:test";

import type { AssetSourceSummary, ManualAssetRecord } from "@/server/ports";

import { defaultManualAssetRecordCurrency } from "./manual-asset-records";
import { buildTotalValuation } from "./valuation";

function record(day: string, currency: ManualAssetRecord["currency"]): ManualAssetRecord {
  return {
    sourceId: "manual-source",
    day,
    amount: "1000",
    currency,
    recordedAt: `${day}T12:00:00.000Z`,
  };
}

for (const currency of ["CNY", "USD", "HKD"] as const) {
  test(`历史多数币种为 ${currency} 时优先于最新记录的其他币种`, () => {
    assert.equal(
      defaultManualAssetRecordCurrency([
        record("2026-08-05", currency),
        record("2026-09-20", currency === "CNY" ? "USD" : "CNY"),
        record("2026-08-16", currency),
      ]),
      currency,
    );
  });
}

test("次数相同时取记录日期最新的币种，不依赖输入顺序或录入时间", () => {
  assert.equal(defaultManualAssetRecordCurrency([
    { ...record("2026-08-05", "CNY"), recordedAt: "2026-09-21T12:00:00.000Z" },
    record("2026-09-20", "HKD"),
    record("2026-08-16", "USD"),
  ]), "HKD");
});

test("多数币种平票时忽略更新的少数币种", () => {
  assert.equal(defaultManualAssetRecordCurrency([
    record("2026-08-05", "USD"),
    record("2026-08-06", "HKD"),
    record("2026-08-12", "USD"),
    record("2026-08-16", "HKD"),
    record("2026-09-20", "CNY"),
  ]), "HKD");
});

test("没有历史记录时默认使用 CNY", () => {
  assert.equal(defaultManualAssetRecordCurrency([]), "CNY");
  assert.equal(defaultManualAssetRecordCurrency(undefined), "CNY");
});

test("选择默认币种不修改原记录或排列顺序", () => {
  const records = Object.freeze([
    Object.freeze(record("2026-08-05", "USD")),
    Object.freeze(record("2026-09-20", "HKD")),
  ]);
  const before = structuredClone(records);
  assert.equal(defaultManualAssetRecordCurrency(records), "HKD");
  assert.deepEqual(records, before);
});

test("待分类手工来源改为证券只调整分布，不改变原币种总额或估值完整性", () => {
  const observedAt = "2026-01-01T00:00:00.000Z";
  const source: AssetSourceSummary = {
    id: "manual", kind: "manual", label: "手工来源", accountId: "manual:fixture",
    permissions: [], credentialReference: null, hasManualRecord: true,
    snapshot: {
      total: { amount: "100000", currency: "CNY" }, holdings: [],
      exchangeRates: [], syncedAt: observedAt,
    },
    sync: { status: "current", lastSuccessfulAt: observedAt, lastAttemptAt: observedAt, error: null },
  };
  const unclassified = buildTotalValuation([source], "CNY", "class");
  const classified = buildTotalValuation([
    { ...source, manualAssetClass: "securities" },
  ], "CNY", "class");

  assert.equal(unclassified.incomplete, false);
  assert.equal(classified.amount, unclassified.amount);
  assert.deepEqual(unclassified.groups, [{ key: "unclassified", label: "待分类", amount: "100000.00" }]);
  assert.deepEqual(classified.groups, [{ key: "securities", label: "证券", amount: "100000.00" }]);
  assert.deepEqual({ ...classified, groups: [] }, { ...unclassified, groups: [] });
});
