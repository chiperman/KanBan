import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTotalValuation,
  convertCurrencyAmount,
  reportingExchangeRatesForSources,
} from "@/domain/valuation";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import type { AssetSourceSummary } from "@/server/ports";

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

test("每日观测使用长桥报告汇率折算其他来源与手工资产", () => {
  const observedAt = "2026-08-11T13:05:23.392Z";
  const currentSync = {
    status: "current" as const,
    lastSuccessfulAt: observedAt,
    lastAttemptAt: observedAt,
    error: null,
  };
  const sources = [{
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
        baseCurrency: "CNY",
        quoteCurrency: "USD",
        rate: "0.2",
        source: "Longbridge",
        observedAt,
      }, {
        baseCurrency: "HKD",
        quoteCurrency: "USD",
        rate: "0.125",
        source: "Longbridge",
        observedAt,
      }],
      syncedAt: observedAt,
    },
    sync: currentSync,
  }, {
    id: "binance",
    kind: "binance",
    label: "Binance",
    accountId: "binance:owner",
    permissions: ["account", "positions"],
    credentialReference: "opaque",
    snapshot: {
      total: { amount: "50", currency: "USDT" },
      holdings: [],
      exchangeRates: [{
        baseCurrency: "USDT",
        quoteCurrency: "USD",
        rate: "1",
        source: "Binance",
        observedAt,
      }],
      syncedAt: observedAt,
    },
    sync: currentSync,
  }, {
    id: "manual-cn",
    kind: "manual",
    label: "A股",
    accountId: "manual:cn",
    permissions: [],
    credentialReference: null,
    hasManualRecord: true,
    manualAssetClass: "securities",
    snapshot: {
      total: { amount: "700", currency: "CNY" },
      holdings: [],
      exchangeRates: [],
      syncedAt: observedAt,
    },
    sync: currentSync,
  }] satisfies AssetSourceSummary[];

  const snapshot = buildDailyAssetSnapshot(sources, observedAt);

  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.total, {
    USD: "290",
    CNY: "1450",
    HKD: "2320",
  });
  assert.deepEqual(
    snapshot.sources.map(({ label, complete, total }) => ({
      label,
      complete,
      total,
    })),
    [{
      label: "长桥",
      complete: true,
      total: { USD: "100", CNY: "500", HKD: "800" },
    }, {
      label: "Binance",
      complete: true,
      total: { USD: "50", CNY: "250", HKD: "400" },
    }, {
      label: "A股",
      complete: true,
      total: { USD: "140", CNY: "700", HKD: "1120" },
    }],
  );
});
