import assert from "node:assert/strict";
import test from "node:test";

import {
  assetClassTrendObservation,
  buildDailyAssetSnapshot,
  sourceTrendClassTotals,
} from "@/domain/daily-asset-snapshots";
import {
  daysForTrendRange,
  sourceTrendObservationStatus,
  totalTrendObservationStatus,
} from "@/domain/daily-trend-observations";
import type { AssetSourceSummary } from "@/server/ports";

const CAPTURED_AT = "2026-08-20T04:00:00.000Z";

test("未知历史来源保留分类未估值，不套用当前来源类型或伪造零值", () => {
  const unavailable = {
    complete: false, status: "incomplete",
    total: { USD: null, CNY: null, HKD: null },
  };
  assert.deepEqual(sourceTrendClassTotals({ kind: "retired-provider" }, {
    complete: true, total: { USD: "10", CNY: "72", HKD: "78" },
  }), { securities: unavailable, crypto: unavailable });
});

function valuedSource(input: {
  assetClass: "securities" | "crypto" | "cash";
  id: string;
  amount: string;
  kind: "binance" | "longbridge";
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind,
    label: input.id,
    accountId: input.id,
    permissions: ["account", "positions", "market-data"],
    credentialReference: `${input.id}-reference`,
    snapshot: {
      total: { amount: input.amount, currency: "USD" },
      holdings: [{
        symbol: input.id,
        name: input.id,
        quantity: "1",
        currency: "USD",
        assetClass: input.assetClass,
        currentPrice: { amount: input.amount, currency: "USD" },
        marketValue: input.amount,
        sourceMarketValue: { amount: input.amount, currency: "USD" },
        valuation: {
          status: "valued",
          priceSource: "测试行情",
          pricedAt: CAPTURED_AT,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        source: "Longbridge",
        observedAt: CAPTURED_AT,
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "Longbridge",
        observedAt: CAPTURED_AT,
      }],
      syncedAt: CAPTURED_AT,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: CAPTURED_AT,
      lastAttemptAt: CAPTURED_AT,
      error: null,
    },
  };
}

test("趋势区间保留连续上海自然日，包括没有观测的日期", () => {
  assert.deepEqual(
    daysForTrendRange("all", "2026-08-09", "2026-08-06"),
    ["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"],
  );
  assert.deepEqual(
    daysForTrendRange("7d", "2026-08-09"),
    [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ],
  );
});

test("来源趋势保留过期状态，兼容旧观测的完整性标记", () => {
  assert.equal(
    sourceTrendObservationStatus({ complete: true, status: "expired" }),
    "expired",
  );
  assert.equal(
    sourceTrendObservationStatus({ complete: false }),
    "incomplete",
  );
});

test("网络失败只让完整来源变旧，不把估值完整性改成不完整", () => {
  const source = valuedSource({
    id: "过期但完整",
    kind: "longbridge",
    assetClass: "securities",
    amount: "100",
  });
  source.sync = {
    ...source.sync,
    status: "expired",
    error: "来源暂时不可用",
  };

  const snapshot = buildDailyAssetSnapshot([source], CAPTURED_AT);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.status, "expired");
  assert.equal(snapshot.sources[0]?.complete, true);
  assert.equal(snapshot.sources[0]?.status, "expired");
});

test("总资产趋势只由自动来源决定过期与不完整状态", () => {
  assert.equal(
    totalTrendObservationStatus([
      { kind: "longbridge", complete: true, status: "complete" },
      { kind: "manual", complete: false, status: "expired" },
    ]),
    "complete",
  );
  assert.equal(
    totalTrendObservationStatus([
      { kind: "binance", complete: true, status: "expired" },
      { kind: "manual", complete: true, status: "complete" },
    ]),
    "expired",
  );
});

test("每日快照按来源分类记录趋势，不为旧历史或不完整观测伪造端点", () => {
  const snapshot = buildDailyAssetSnapshot([
    valuedSource({
      id: "证券来源",
      kind: "longbridge",
      assetClass: "cash",
      amount: "100",
    }),
    valuedSource({
      id: "加密来源",
      kind: "binance",
      assetClass: "cash",
      amount: "50",
    }),
  ], CAPTURED_AT);

  assert.deepEqual(assetClassTrendObservation(snapshot, "securities"), {
    complete: true,
    status: "complete",
    total: { USD: "100", CNY: "720", HKD: "780" },
  });
  assert.deepEqual(assetClassTrendObservation(snapshot, "crypto"), {
    complete: true,
    status: "complete",
    total: { USD: "50", CNY: "360", HKD: "390" },
  });

  const oldSnapshot = structuredClone(snapshot);
  delete oldSnapshot.sources[0].assetClassTotals;
  assert.equal(assetClassTrendObservation(oldSnapshot, "securities"), null);

  const expiredSnapshot = structuredClone(snapshot);
  expiredSnapshot.sources[0].assetClassTotals!.securities = {
    complete: false,
    status: "expired",
    total: { USD: "100", CNY: "720", HKD: "780" },
  };
  assert.deepEqual(assetClassTrendObservation(expiredSnapshot, "securities"), {
    complete: false,
    status: "expired",
    total: { USD: "100", CNY: "720", HKD: "780" },
  });
});
