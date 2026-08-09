import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTotalValuation,
  convertCurrencyAmount,
  reportingExchangeRatesForSources,
} from "@/domain/valuation";

test("来源详情汇总汇率时优先使用长桥的 USD/CNY 观察", () => {
  const rates = reportingExchangeRatesForSources([
    {
      kind: "manual",
      hasManualRecord: true,
      snapshot: {
        exchangeRates: [],
      },
    },
    {
      kind: "binance",
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.3",
          source: "Binance",
          observedAt: "2026-08-09T00:00:00.000Z",
        }],
      },
    },
    {
      kind: "longbridge",
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "长桥",
          observedAt: "2026-08-09T00:00:00.000Z",
        }],
      },
    },
  ]);

  assert.equal(convertCurrencyAmount("72000", "CNY", "USD", rates), "10000");
});

test("非 USD 报告金额缺少长桥观察时不回退其他来源汇率", () => {
  const valuation = buildTotalValuation(
    [{
      id: "binance-only-rate",
      kind: "binance",
      label: "Binance 账户",
      snapshot: {
        total: { amount: "100", currency: "USD" },
        holdings: [],
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.3",
          source: "Binance",
          observedAt: "2026-08-09T00:00:00.000Z",
        }],
        syncedAt: "2026-08-09T00:00:00.000Z",
      },
      sync: {
        status: "current",
        lastSuccessfulAt: "2026-08-09T00:00:00.000Z",
        lastAttemptAt: "2026-08-09T00:00:00.000Z",
        error: null,
      },
    }],
    "CNY",
    "source",
  );

  assert.equal(valuation.amount, null);
  assert.equal(valuation.conversion, null);
  assert.equal(valuation.incomplete, true);
});
