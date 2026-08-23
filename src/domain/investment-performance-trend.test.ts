import assert from "node:assert/strict";
import test from "node:test";

import {
  projectInvestmentPerformanceTrend,
  type InvestmentPerformanceIntervalPreset,
} from "@/domain/investment-performance-trend";
import type {
  DailyAssetClassTotal,
  DailyAssetTrendObservation,
} from "@/server/ports";

const COMPLETE = "complete" as const;

function classTotal(amount: string): DailyAssetClassTotal {
  return {
    complete: true,
    status: COMPLETE,
    total: { USD: amount, CNY: null, HKD: null },
  };
}

function observation(input: {
  amount: string | null;
  day: string;
  status?: "complete" | "incomplete" | "expired";
  withClassTotals?: boolean;
}): DailyAssetTrendObservation {
  const status = input.status ?? COMPLETE;
  return {
    capturedAt: `${input.day}T04:00:00.000Z`,
    complete: status === COMPLETE,
    day: input.day,
    status,
    total: { USD: input.amount, CNY: null, HKD: null },
    sources: [{
      capturedAt: `${input.day}T04:00:00.000Z`,
      complete: status === COMPLETE,
      kind: "longbridge",
      label: "证券账户",
      sourceId: "securities",
      status,
      total: { USD: input.amount, CNY: null, HKD: null },
      ...(input.withClassTotals === false
        ? {}
        : {
            assetClassTotals: {
              crypto: classTotal("0"),
              securities: input.amount === null
                ? {
                    complete: false,
                    status: "incomplete" as const,
                    total: { USD: null, CNY: null, HKD: null },
                  }
                : classTotal(input.amount),
            },
          }),
    }],
  };
}

function project(
  preset: InvestmentPerformanceIntervalPreset,
  trendObservations: DailyAssetTrendObservation[],
  assetScope: "portfolio" | "securities" | "crypto" = "portfolio",
  customRange?: { startDay: string; endDay: string },
) {
  return projectInvestmentPerformanceTrend({
    assetScope,
    currency: "USD",
    customRange,
    currentDay: "2024-03-31",
    preset,
    trendObservations,
  });
}

test("收益分析预设区间按连续上海自然日跨月末和闰年计算", () => {
  const observations = [observation({
    amount: "100",
    day: "2024-02-28",
  })];
  type Preset = Exclude<InvestmentPerformanceIntervalPreset, "custom">;
  const expectations: Record<Preset, {
    firstDay: string;
    length: number;
  }> = {
    "month-to-date": { firstDay: "2024-03-01", length: 31 },
    "1m": { firstDay: "2024-02-29", length: 32 },
    "6m": { firstDay: "2023-09-30", length: 184 },
    "year-to-date": { firstDay: "2024-01-01", length: 91 },
    "1y": { firstDay: "2023-03-31", length: 367 },
    all: { firstDay: "2024-02-28", length: 33 },
  };

  for (const [preset, expected] of Object.entries(expectations) as Array<
    [Preset, typeof expectations[Preset]]
  >) {
    const result = project(preset, observations);
    assert.equal(result.days[0], expected.firstDay, preset);
    assert.equal(result.days.at(-1), "2024-03-31", preset);
    assert.equal(result.days.length, expected.length, preset);
  }
});

test("收益分析自定义区间按所选连续上海自然日投影", () => {
  const result = project(
    "custom",
    [
      observation({ amount: "100", day: "2024-03-02" }),
      observation({ amount: "130", day: "2024-03-04" }),
    ],
    "portfolio",
    { startDay: "2024-03-02", endDay: "2024-03-04" },
  );

  assert.deepEqual(
    result.days,
    ["2024-03-02", "2024-03-03", "2024-03-04"],
  );
  assert.equal(result.missingCount, 1);
  assert.equal(result.startDay, "2024-03-02");
  assert.equal(result.endDay, "2024-03-04");
  assert.equal(result.intervalAssetChange, "30");
});

test("趋势投影保留缺失上海自然日为空值，并在区间内选择完整端点", () => {
  const result = project("month-to-date", [
    observation({ amount: "100", day: "2024-03-01" }),
    observation({ amount: "130", day: "2024-03-04" }),
  ]);

  assert.deepEqual(
    result.points.slice(0, 4).map(({ amount, day, observed, status }) => ({
      amount,
      day,
      observed,
      status,
    })),
    [
      { amount: "100", day: "2024-03-01", observed: true, status: COMPLETE },
      { amount: null, day: "2024-03-02", observed: false, status: "incomplete" },
      { amount: null, day: "2024-03-03", observed: false, status: "incomplete" },
      { amount: "130", day: "2024-03-04", observed: true, status: COMPLETE },
    ],
  );
  assert.equal(result.missingCount, 29);
  assert.equal(result.startDay, "2024-03-01");
  assert.equal(result.endDay, "2024-03-04");
  assert.equal(result.intervalAssetChange, "30");
});

test("旧分类趋势没有分类总额时保留为缺失，不伪造分类端点", () => {
  const result = project(
    "all",
    [observation({
      amount: "100",
      day: "2024-03-01",
      withClassTotals: false,
    })],
    "securities",
  );

  assert.deepEqual(result.points[0], {
    amount: null,
    day: "2024-03-01",
    observed: false,
    status: "incomplete",
  });
  assert.equal(result.missingCount, 31);
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.equal(result.intervalAssetChange, null);
});

test("过期和不完整端点不参与区间资产变动，区间内完整观测仍可作为端点", () => {
  const result = project("month-to-date", [
    observation({ amount: "100", day: "2024-03-01", status: "expired" }),
    observation({ amount: "120", day: "2024-03-02" }),
    observation({ amount: "150", day: "2024-03-03" }),
    observation({ amount: "200", day: "2024-03-04", status: "incomplete" }),
  ]);

  assert.equal(result.startDay, "2024-03-02");
  assert.equal(result.start?.amount, "120");
  assert.equal(result.endDay, "2024-03-03");
  assert.equal(result.end?.amount, "150");
  assert.equal(result.intervalAssetChange, "30");
  assert.equal(result.incompleteCount, 2);
});

test("分类趋势只产生分类资产变动，不分摊组合资金账本或生成分类收益", () => {
  const result = project(
    "all",
    [
      observation({ amount: "100", day: "2024-03-01" }),
      observation({ amount: "120", day: "2024-03-02" }),
    ],
    "securities",
  );

  assert.equal(result.intervalAssetChange, "20");
  assert.equal("netExternalCashflow" in result, false);
  assert.equal("investmentProfit" in result, false);
  assert.equal("investmentProfitRatio" in result, false);
});
