import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCurrentInvestmentPerformance,
  analyzeInvestmentPerformance,
  valueInvestmentCashflow,
} from "@/domain/investment-performance";
import type { InvestmentCashflow } from "@/server/ports";

test("当前本金与盈亏以 USD 为基准按当前汇率展示，不依赖历史目标币种金额", () => {
  const cashflows: InvestmentCashflow[] = [
    { kind: "initial-investment", amount: "10000" },
    { kind: "external-deposit", amount: "2000" },
    { kind: "external-withdrawal", amount: "500" },
  ].map(({ kind, amount }, index) => ({
    id: String(index),
    kind: kind as InvestmentCashflow["kind"],
    amount,
    currency: "USD",
    occurredAt: `2026-08-0${index + 1}T00:00:00.000Z`,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    note: null,
    amounts: { USD: amount, CNY: null, HKD: null },
    exchangeRates: [],
  }));
  const original = structuredClone(cashflows);
  const input = {
    asOf: "2026-08-05T00:00:00.000Z",
    currentUsdTotal: {
      amount: "16000",
      complete: true,
      observedAt: "2026-08-05T00:00:00.000Z",
    },
    cashflows,
    exchangeRates: [
      { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2",
        source: "Longbridge", observedAt: "2026-08-05T00:00:00.000Z" },
      { baseCurrency: "HKD", quoteCurrency: "USD", rate: "0.125",
        source: "Longbridge", observedAt: "2026-08-05T00:00:00.000Z" },
    ],
  };
  for (const [currency, cumulativeNetInvestment, investmentProfit] of [
    ["USD", "11500", "4500"],
    ["CNY", "82800", "32400"],
    ["HKD", "92000", "36000"],
  ] as const) {
    assert.deepEqual(analyzeCurrentInvestmentPerformance({ ...input, currency }), {
      cumulativeNetInvestment, investmentProfit,
    });
  }
  assert.deepEqual(cashflows, original);
  assert.deepEqual(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY", exchangeRates: [],
  }), { cumulativeNetInvestment: null, investmentProfit: null });
  assert.deepEqual(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY", cashflows: [],
  }), { cumulativeNetInvestment: null, investmentProfit: null });
  assert.deepEqual(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY",
    currentUsdTotal: { ...input.currentUsdTotal, complete: false },
  }), { cumulativeNetInvestment: "82800", investmentProfit: null });
  assert.deepEqual(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY",
    currentUsdTotal: { ...input.currentUsdTotal, amount: "11000" },
  }), { cumulativeNetInvestment: "82800", investmentProfit: "-3600" });
  cashflows[0].amounts.CNY = "60000";
  assert.equal(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY",
  }).cumulativeNetInvestment, "82800");
  cashflows[0].amounts.USD = null;
  assert.deepEqual(analyzeCurrentInvestmentPerformance({
    ...input, currency: "CNY",
  }), { cumulativeNetInvestment: null, investmentProfit: null });
});

test("资金账本以长桥参考汇率保存三币种可用值，缺失汇率时不伪造折算", () => {
  const valued = valueInvestmentCashflow(
    {
      kind: "external-deposit",
      occurredAt: "2026-08-03T04:00:00.000Z",
      amount: "7200",
      currency: "CNY",
      note: "追加本金",
    },
    [{
      kind: "binance",
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.3",
          source: "Binance",
          observedAt: "2026-08-03T04:00:00.000Z",
        }],
      },
    }, {
      kind: "longbridge",
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "Longbridge",
          observedAt: "2026-08-03T04:01:00.000Z",
        }, {
          baseCurrency: "USD",
          quoteCurrency: "HKD",
          rate: "7.8",
          source: "Longbridge",
          observedAt: "2026-08-03T04:01:00.000Z",
        }],
      },
    }],
  );

  assert.deepEqual(valued.amounts, {
    USD: "1000",
    CNY: "7200",
    HKD: "7800",
  });
  assert.deepEqual(
    valued.exchangeRates.map(({ source, rate }) => ({ source, rate })),
    [
      { source: "Longbridge", rate: "7.2" },
      { source: "Longbridge", rate: "7.8" },
    ],
  );

  const unavailable = valueInvestmentCashflow(
    {
      kind: "external-deposit",
      occurredAt: "2026-08-03T04:00:00.000Z",
      amount: "7200",
      currency: "CNY",
      note: null,
    },
    [],
  );
  assert.deepEqual(unavailable.amounts, {
    USD: null,
    CNY: "7200",
    HKD: null,
  });
});

test("组合与区间投资盈亏从完整资产端点和外部资金进出派生", () => {
  const analysis = analyzeInvestmentPerformance({
    currency: "USD",
    asOf: "2026-08-05T00:00:00.000Z",
    currentTotal: {
      amount: "16000",
      complete: true,
      observedAt: "2026-08-05T00:00:00.000Z",
    },
    cashflows: [{
      id: "initial",
      kind: "initial-investment",
      occurredAt: "2026-08-01T00:00:00.000Z",
      amount: "10000",
      currency: "USD",
      note: null,
      amounts: { USD: "10000", CNY: "72000", HKD: "78000" },
      exchangeRates: [],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }, {
      id: "deposit",
      kind: "external-deposit",
      occurredAt: "2026-08-03T00:00:00.000Z",
      amount: "2000",
      currency: "USD",
      note: null,
      amounts: { USD: "2000", CNY: "14400", HKD: "15600" },
      exchangeRates: [],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }, {
      id: "withdrawal",
      kind: "external-withdrawal",
      occurredAt: "2026-08-04T00:00:00.000Z",
      amount: "500",
      currency: "USD",
      note: "取回部分本金",
      amounts: { USD: "500", CNY: "3600", HKD: "3900" },
      exchangeRates: [],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }],
    interval: {
      start: {
        amount: "10000",
        complete: true,
        observedAt: "2026-08-01T00:00:00.000Z",
      },
      end: {
        amount: "16000",
        complete: true,
        observedAt: "2026-08-05T00:00:00.000Z",
      },
    },
  });

  assert.deepEqual(analysis.current, {
    cumulativeNetInvestment: "11500",
    investmentProfit: "4500",
  });
  assert.deepEqual(analysis.interval, {
    assetChange: "6000",
    netExternalCashflow: "1500",
    investmentProfit: "4500",
    investmentProfitRatio: "0.413793103448275862",
  });
});

test("没有初始投入事实时不把全部资产误判为投资盈亏", () => {
  const analysis = analyzeInvestmentPerformance({
    currency: "USD",
    asOf: "2026-08-05T00:00:00.000Z",
    currentTotal: {
      amount: "16000",
      complete: true,
      observedAt: "2026-08-05T00:00:00.000Z",
    },
    cashflows: [],
    interval: null,
  });

  assert.deepEqual(analysis.current, {
    cumulativeNetInvestment: null,
    investmentProfit: null,
  });
});
