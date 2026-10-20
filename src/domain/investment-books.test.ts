import assert from "node:assert/strict";
import test from "node:test";
import { analyzeInvestmentBook, migrateInvestmentBooks, validateInvestmentBookState } from "./investment-books";
import type { AssetSourceSummary, DailyAssetTrendObservation, InvestmentCashflow } from "@/server/ports";
import type { SourceInvestmentHistory } from "./source-investment-history";

const at = "2026-10-18T08:00:00.000Z";
function source(id: string, kind: AssetSourceSummary["kind"], amount = "120"): AssetSourceSummary {
  return {
    id, kind, label: id, accountId: id, credentialReference: null, permissions: [], lifecycle: "connected",
    snapshot: { total: { amount, currency: "USD" }, holdings: [], exchangeRates: [], syncedAt: at },
    sync: { status: "current", lastAttemptAt: at, lastSuccessfulAt: at, error: null },
  };
}
function history(sourceId = "lb"): SourceInvestmentHistory {
  return {
    sourceId, sourceLabel: sourceId, provider: "external-ledger", accountId: "external-lb", accountName: "历史",
    currency: "USD", openingInvestment: { day: "2026-10-01", amount: "0" }, openingBasis: "从零开始", importedAt: at,
    records: [
      { id: "d1", kind: "deposit", day: "2026-10-01", amount: "100" },
      { id: "v1", kind: "valuation", day: "2026-10-01", amount: "100" },
      { id: "v2", kind: "valuation", day: "2026-10-11", amount: "110" },
    ],
    reconciliation: { asOf: "2026-10-11", netInvestment: "100", total: "110", profit: "10" },
  };
}

test("历史本金只算一次，历史截止前整账金额替换自动观测，截止后接自动余额", () => {
  const sources = [source("lb", "longbridge")];
  const flows: InvestmentCashflow[] = [{
    id: "legacy", kind: "initial-investment", amount: "100", currency: "USD",
    occurredAt: "2026-10-01T04:00:00Z", createdAt: at, updatedAt: at, note: "外部账户 external-lb",
    amounts: { USD: "100", CNY: null, HKD: null }, exchangeRates: [],
  }];
  const state = migrateInvestmentBooks({ sources, histories: [history()], sourceRecords: [], cashflows: flows });
  assert.deepEqual(state.legacyLinks, [{ cashflowId: "legacy", recordId: "history:external-ledger:external-lb:d1" }]);
  assert.deepEqual(state.unassignedLegacyIds, []);
  const observations = [{
    day: "2026-10-11", sources: [{ sourceId: "lb", complete: true, total: { USD: "999" } }],
  }] as DailyAssetTrendObservation[];
  const result = analyzeInvestmentBook({ state, bookId: "us-stocks", sources, observations, manualRecords: [], currentDay: "2026-10-18" });
  assert.equal(result.points.find(row => row.day === "2026-10-11")?.total, "110");
  assert.equal(result.current?.total, "120");
  assert.equal(result.current?.netInvestment, "100");
  assert.equal(result.current?.profit, "20");
  assert.equal(result.current?.returnRatio, "0.2");
  assert.deepEqual(result.historyComparison, { day: "2026-10-11", historicalTotal: "110", automaticTotal: "999", difference: "889" });
  assert.deepEqual(state.imports, [history()], "完整原件保留");
  const tampered = structuredClone(state);
  tampered.records.find(row => row.kind === "deposit")!.amount = "200";
  assert.throws(() => validateInvestmentBookState(tampered), /原件与账本/);
  assert.throws(() => validateInvestmentBookState({ ...state, historyThroughDay: { "us-stocks": "2026-10-10" } }), /衔接日期/);
});

test("截止日保留历史与自动金额差异供核对，次日接自动资产而不补造资金", () => {
  const sources = [source("exchange", "binance", "150"), source("wallet", "evm-watch-ethereum", "50")];
  const imported = history("exchange");
  imported.records[2].day = "2026-10-18";
  imported.reconciliation.asOf = "2026-10-18";
  const state = migrateInvestmentBooks({ sources, histories: [imported], sourceRecords: [], cashflows: [] });
  const today = analyzeInvestmentBook({ state, bookId: "crypto", sources, observations: [], manualRecords: [], currentDay: "2026-10-18" });
  assert.equal(today.current?.total, "110");
  assert.equal(today.current?.netInvestment, "100");
  assert.equal(today.current?.profit, "10");
  assert.deepEqual(today.historyComparison, { day: "2026-10-18", historicalTotal: "110", automaticTotal: "200", difference: "90" });
  for (const source of sources) source.snapshot.syncedAt = "2026-10-19T08:00:00.000Z";
  const tomorrow = analyzeInvestmentBook({ state, bookId: "crypto", sources, observations: [], manualRecords: [], currentDay: "2026-10-19" });
  assert.equal(tomorrow.current?.total, "200");
  assert.equal(tomorrow.current?.netInvestment, "100");
  assert.equal(state.records.filter(row => row.kind === "deposit").length, 1, "差额不会补造入金");
  assert.equal(state.records.length, 4, "分析不改写原件");
  sources[0].sync.status = "expired";
  assert.equal(analyzeInvestmentBook({ state, bookId: "crypto", sources, observations: [], manualRecords: [], currentDay: "2026-10-19" }).current?.total, null);
});

test("虚拟货币合并多个账户，未补历史本金不猜分摊；资金进出不改变余额", () => {
  const sources = [source("exchange", "binance", "100"), source("wallet", "evm-watch-ethereum", "50")];
  const state = migrateInvestmentBooks({ sources, histories: [], sourceRecords: [], cashflows: [] });
  const analyze = () => analyzeInvestmentBook({ state, bookId: "crypto", sources, observations: [], manualRecords: [], currentDay: "2026-10-18" });
  assert.equal(analyze().current?.total, "150");
  assert.equal(analyze().current?.netInvestment, null);
  state.records.push(
    { id: "opening", originKey: "manual:opening", origin: "manual", bookId: "crypto", kind: "opening", day: "2026-10-01", amount: "100", currency: "USD", recordedAt: at, note: "" },
    { id: "withdrawal", originKey: "manual:withdrawal", origin: "manual", bookId: "crypto", kind: "withdrawal", day: "2026-10-10", amount: "20", currency: "USD", recordedAt: at, note: "" },
  );
  assert.equal(analyze().current?.total, "150");
  assert.equal(analyze().current?.netInvestment, "80");
  assert.equal(analyze().current?.profit, "70");
  assert.ok(state.records.every(row => !("sourceId" in row)), "资金归属整本账");
  sources[1].sync.status = "expired";
  assert.equal(analyze().current?.total, null, "不能把失败账户当成零");
  sources[1].sync.status = "current";
  state.members[1].confirmed = false;
  assert.equal(analyze().current?.total, null, "新来源未确认时不能悄悄改变收益范围");
  state.members[1].confirmed = true;
  sources[1].snapshot.total.currency = "CNY";
  assert.equal(analyze().current?.total, null, "缺少汇率不能伪造零值");
});

test("A股沿用周度手动余额，导入重叠日只算一个总额，待归属旧资金暂停收益", () => {
  const manual = { ...source("a", "manual"), manualAssetClass: "securities" as const };
  const imported = { ...history("a"), currency: "CNY" as const };
  const state = migrateInvestmentBooks({ sources: [manual], histories: [imported], cashflows: [], sourceRecords: [
    { id: "old-value", sourceId: "a", day: "2026-10-11", kind: "valuation", amount: "999", currency: "CNY", recordedAt: at },
  ] });
  assert.ok(state.records.find(row => row.id === "old-value")?.voidedAt, "旧值保留供审计");
  const analyze = () => analyzeInvestmentBook({ state, bookId: "a-shares", sources: [manual], observations: [], manualRecords: [
    { sourceId: "a", day: "2026-10-11", amount: "999", currency: "CNY", recordedAt: at },
    { sourceId: "a", day: "2026-10-18", amount: "130", currency: "CNY", recordedAt: at },
  ], currentDay: "2026-10-19" });
  assert.equal(analyze().points.find(row => row.day === "2026-10-11")?.total, "110");
  assert.equal(analyze().current?.day, "2026-10-18");
  assert.equal(analyze().current?.profit, "30");
  state.unassignedLegacyIds.push("uncertain");
  assert.equal(analyze().current?.profit, null);
});
