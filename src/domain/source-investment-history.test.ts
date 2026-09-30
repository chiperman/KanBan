import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceInvestmentAccount, analyzeSourceInvestmentHistory, parseSourceInvestmentHistory } from "./source-investment-history";

export function historyFixture(sourceId = "a-share") {
  return {
    sourceId, sourceLabel: "A股", provider: "youzhiyouxing", accountId: "test-account", accountName: "大A账户", currency: "CNY",
    openingInvestment: { day: "2026-01-01", amount: "100" },
    openingBasis: "用户确认的期初本金", importedAt: "2026-01-11T12:00:00.000Z",
    records: [
      { id: "v1", day: "2026-01-01", kind: "valuation", amount: "100" },
      { id: "d1", day: "2026-01-06", kind: "deposit", amount: "100" },
      { id: "v2", day: "2026-01-11", kind: "valuation", amount: "180" },
    ],
    reconciliation: { asOf: "2026-01-11", netInvestment: "200", total: "180", profit: "-20" },
  };
}

test("余额上涨80%而本金亏损时，两条曲线都应为负；投入不能当作收益", () => {
  const history = parseSourceInvestmentHistory(historyFixture());
  const result = analyzeSourceInvestmentHistory(history, [], "2026-01-11");
  assert.equal(result.current?.netInvestment, "200");
  assert.equal(result.current?.profit, "-20");
  assert.ok(Math.abs(Number(result.current?.returnRatio) - (-20 / 150)) < 1e-10);
  assert.equal(result.points.length, 2, "没有资产记录的入金日不能伪造估值");
});

test("有知有行同日优先，保留本地独有日期且隔离其他账户", () => {
  const result = analyzeSourceInvestmentHistory(parseSourceInvestmentHistory(historyFixture()), [
    { sourceId: "a-share", day: "2026-01-11", amount: "170", currency: "CNY", recordedAt: "2026-01-11T12:00:00Z" },
    { sourceId: "longbridge", day: "2026-01-12", amount: "999999", currency: "CNY", recordedAt: "2026-01-12T12:00:00Z" },
    { sourceId: "a-share", day: "2026-01-12", amount: "160", currency: "CNY", recordedAt: "2026-01-12T12:00:00Z" },
  ], "2026-01-12");
  assert.equal(result.points.find(p => p.day === "2026-01-11")?.profit, "-20");
  assert.equal(result.current?.profit, "-40");
  assert.equal(result.current?.total, "160");
});

test("自动账户合并外部历史、手工投入取出和最新余额，不重复期初本金", () => {
  const history = parseSourceInvestmentHistory({...historyFixture("longbridge"), currency:"USD"});
  const records = [
    {id:"deposit",sourceId:"longbridge",kind:"deposit" as const,day:"2026-01-12",amount:"50",currency:"USD" as const,recordedAt:"2026-01-12T12:00:00Z"},
    {id:"withdraw",sourceId:"longbridge",kind:"withdrawal" as const,day:"2026-01-13",amount:"20",currency:"USD" as const,recordedAt:"2026-01-13T12:00:00Z"},
    {id:"value",sourceId:"longbridge",kind:"valuation" as const,day:"2026-01-13",amount:"250",currency:"USD" as const,recordedAt:"2026-01-13T12:00:00Z"},
    {id:"other",sourceId:"a-share",kind:"deposit" as const,day:"2026-01-12",amount:"999999",currency:"USD" as const,recordedAt:"2026-01-12T12:00:00Z"},
  ];
  const result = analyzeSourceInvestmentAccount({history,sourceId:"longbridge",records,manualRecords:[],observations:[],currentDay:"2026-01-14",snapshot:{total:{amount:"260",currency:"USD"},holdings:[],exchangeRates:[],syncedAt:"2026-01-14T01:00:00Z"}});
  assert.equal(result.current?.netInvestment,"230");
  assert.equal(result.points.find(p=>p.day==="2026-01-13")?.profit,"20");
  assert.equal(result.current?.profit,"30");
  assert.equal(result.current?.day,"2026-01-14");
});

test("无期初本金不能把余额算作收益；明确期初零本金时首次投入只计算一次", () => {
  const records = [
    {id:"deposit",sourceId:"new",kind:"deposit" as const,day:"2026-01-01",amount:"100",currency:"USD" as const,recordedAt:"2026-01-01T00:00:00Z"},
    {id:"value",sourceId:"new",kind:"valuation" as const,day:"2026-01-11",amount:"90",currency:"USD" as const,recordedAt:"2026-01-11T00:00:00Z"},
  ];
  const input = {history:null,sourceId:"new",records,manualRecords:[],observations:[],currentDay:"2026-01-11"};
  assert.equal(analyzeSourceInvestmentAccount(input).current,null);
  assert.match(analyzeSourceInvestmentAccount(input).missingReason ?? "",/期初本金/);
  const result=analyzeSourceInvestmentAccount({...input,records:[...records,{id:"opening",sourceId:"new",kind:"opening",day:"2026-01-01",amount:"0",currency:"USD",recordedAt:"2026-01-01T00:00:00Z"}]});
  assert.equal(result.current?.netInvestment,"100");
  assert.equal(result.current?.profit,"-10");
  assert.equal(result.current?.returnRatio,"-0.1");
});

test("导入拒绝重复编号、对账不平与无效日期", () => {
  const duplicated = historyFixture(); duplicated.records.push(duplicated.records[0]);
  assert.throws(() => parseSourceInvestmentHistory(duplicated), /重复/);
  const unbalanced = historyFixture(); unbalanced.reconciliation.netInvestment = "999";
  assert.throws(() => parseSourceInvestmentHistory(unbalanced), /对账/);
  const badDay = historyFixture(); badDay.records[0].day = "2026-02-30";
  assert.throws(() => parseSourceInvestmentHistory(badDay), /日期/);
});
