import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetExchangeRate,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";
import { assetSourceTrendModel } from "@/ui/asset-source-card/source-trend-model";

function source(
  overrides: Partial<DailyAssetSourceSnapshot> = {},
): DailyAssetSourceSnapshot {
  return {
    sourceId: "source-1",
    label: "测试来源",
    kind: "longbridge",
    capturedAt: "2026-10-01T00:00:00.000Z",
    complete: true,
    total: { USD: "100", CNY: "700", HKD: "780" },
    ...overrides,
  };
}

function snapshot(
  day: string,
  sources: DailyAssetSourceSnapshot[] = [source()],
  exchangeRates?: AssetExchangeRate[],
): DailyAssetTrendObservation {
  return {
    day,
    capturedAt: `${day}T00:00:00.000Z`,
    complete: true,
    total: { USD: "9999", CNY: "69993", HKD: "77992.2" },
    sources,
    exchangeRates,
  };
}

function record(
  day: string,
  amount: string,
  currency: ManualAssetRecord["currency"] = "USD",
): ManualAssetRecord {
  return {
    sourceId: "source-1",
    day,
    amount,
    currency,
    recordedAt: `${day}T00:00:00.000Z`,
  };
}

function usdToCny(day: string, rate: string): AssetExchangeRate[] {
  return [{
    baseCurrency: "USD", quoteCurrency: "CNY", rate,
    source: "测试汇率", observedAt: `${day}T00:00:00.000Z`,
  }];
}

function trend(overrides: Partial<Parameters<typeof assetSourceTrendModel>[0]> = {}) {
  return assetSourceTrendModel({
    currentDay: "2026-10-05",
    history: [],
    isManual: false,
    manualRecords: [],
    reportingCurrency: "USD",
    sourceId: "source-1",
    trendRange: "7d",
    ...overrides,
  });
}

test("手工来源趋势按阶梯延续最近记录，不把延续日伪造成观测", () => {
  const model = trend({
    history: [
      snapshot("2026-10-01", [source({ kind: "manual" })]),
      snapshot("2026-10-04", [source({
        kind: "manual", total: { USD: "200", CNY: "1400", HKD: "1560" },
      })]),
    ],
    isManual: true,
    manualRecords: [
      record("2026-10-04", "200"), record("2026-10-01", "100"),
    ],
    trendDays: [
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
    ],
  });

  assert.deepEqual(
    model.points.map((point) => [point.amount, point.manualRecordDay, point.observed]),
    [
      ["100", "2026-10-01", true],
      ["100", "2026-10-01", false],
      ["100", "2026-10-01", false],
      ["200", "2026-10-04", true],
      ["200", "2026-10-04", false],
    ],
  );
  assert.equal(model.notice, "手工记录");
});

test("自动来源只使用自身观测，不借用其他来源或组合总额", () => {
  const selected = source();
  const other = source({ sourceId: "other", status: "expired" });
  const model = trend({
    history: [snapshot("2026-10-01", [other, selected]), snapshot("2026-10-02", [other])],
    trendDays: ["2026-10-01", "2026-10-02", "2026-10-03"],
  });

  assert.deepEqual(model.sourceHistory, [{ day: "2026-10-01", ...selected }]);
  assert.deepEqual(model.points, [
    { day: "2026-10-01", amount: "100", observed: true, status: "complete" },
    { day: "2026-10-02", amount: null, observed: false, status: "incomplete" },
    { day: "2026-10-03", amount: null, observed: false, status: "incomplete" },
  ]);
  assert.equal(model.missingDayCount, 2);
  assert.equal(model.notice, "缺少 2 天观测");
  assert.deepEqual(model.unavailablePoints, []);
  assert.deepEqual(model.abnormalPoints, []);
});

test("自动来源区分零值、未估值、缺失日、过期和旧记录的不完整状态", () => {
  const days = Array.from({ length: 7 }, (_, index) => `2026-10-0${index + 1}`);
  const model = trend({
    history: [
      snapshot(days[0], [source({ total: { USD: "0", CNY: "0" } })]),
      snapshot(days[1], [source({ total: { USD: null, CNY: null }, status: "expired" })]),
      snapshot(days[3], [source({ sourceId: "other" })]),
      snapshot(days[4], [source({ status: "expired" })]),
      snapshot(days[5], [source({ complete: false })]),
      snapshot(days[6], [source({ complete: true, status: "incomplete" })]),
    ],
    trendDays: days,
  });

  assert.deepEqual(model.points.map(({ amount, observed, status }) => [amount, observed, status]), [
    ["0", true, "complete"], [null, true, "expired"],
    [null, false, "incomplete"], [null, false, "incomplete"],
    ["100", true, "expired"], ["100", true, "incomplete"], ["100", true, "incomplete"],
  ]);
  assert.deepEqual(model.unavailablePoints, [model.points[1]]);
  assert.deepEqual(model.abnormalPoints, model.points.slice(4));
  assert.equal(model.missingDayCount, 2);
  assert.equal(model.notice, "缺少 2 天观测 · 数据受限：3 天不完整或过期 · 1 天未估值");
});

test("自动来源按展示币种读取历史金额，不补算旧记录缺失的币种", () => {
  const history = [snapshot("2026-10-01", [source({
    total: { USD: "100", CNY: null },
  })], usdToCny("2026-10-01", "7"))];
  for (const reportingCurrency of ["USD", "CNY", "HKD"] as const) {
    const model = trend({ history, reportingCurrency, trendDays: ["2026-10-01"] });
    assert.equal(model.points[0].amount, reportingCurrency === "USD" ? "100" : null);
    assert.equal(model.points[0].observed, true);
    assert.equal(model.missingDayCount, 0);
    assert.equal(model.notice, reportingCurrency === "USD" ? "" : "数据受限：1 天未估值");
  }
});

test("每日详情独立倒序排列且保留区间外历史，不修改输入观测", () => {
  const history = Object.freeze([
    snapshot("2026-10-03"), snapshot("2026-10-01"),
    snapshot("2026-09-01", [source({ sourceId: "other" })]), snapshot("2026-10-02"),
  ]);
  const before = structuredClone(history);
  const model = trend({ history, trendDays: ["2026-10-02"] });

  assert.deepEqual(model.sourceHistory.map(({ day }) => day), ["2026-10-03", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(model.sourceDailyDetails.map(({ day }) => day), ["2026-10-03", "2026-10-02", "2026-10-01"]);
  assert.equal(model.points.length, 1);
  assert.deepEqual(history, before);
});

test("空历史仍生成连续自然日，手工来源不统计为缺少自动观测", () => {
  for (const isManual of [false, true]) {
    for (const trendRange of ["7d", "all"] as const) {
      const model = trend({ isManual, trendRange });
      const count = trendRange === "7d" ? 7 : 30;
      assert.equal(model.points.length, count);
      assert.equal(model.points[0].day, trendRange === "7d" ? "2026-09-29" : "2026-09-06");
      assert.equal(model.points.at(-1)?.day, "2026-10-05");
      assert.ok(model.points.every((point) => point.amount === null && !point.observed && point.status === "incomplete"));
      assert.equal(model.missingDayCount, isManual ? 0 : count);
      assert.equal(model.notice, isManual ? "手工记录" : `缺少 ${count} 天观测`);
      assert.deepEqual(model.sourceDailyDetails, []);
      assert.deepEqual(model.unavailablePoints, []);
      assert.deepEqual(model.abnormalPoints, []);
    }
  }
});

test("全部趋势区间从自身最早观测或手工记录开始，而非组合起始日", () => {
  const history = [
    snapshot("2026-09-01", [source({ sourceId: "other" })]),
    snapshot("2026-10-03"), snapshot("2026-10-01"),
  ];
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  assert.deepEqual(trend({ history, trendRange: "all" }).points.map(({ day }) => day), days);
  assert.deepEqual(trend({
    history, isManual: true, trendRange: "all",
    manualRecords: [record("2026-10-02", "200"), record("2026-09-30", "100")],
  }).points.map(({ day }) => day), ["2026-09-30", ...days]);
});

test("显式趋势日期优先于区间并保留传入顺序，空日期不回退到默认区间", () => {
  for (const isManual of [false, true]) {
    const input = {
      history: [snapshot("2026-10-01")], isManual,
      manualRecords: [record("2026-10-01", "100")],
    };
    const days = Object.freeze(["2026-10-05", "2026-10-01", "2026-10-03"]);
    assert.deepEqual(trend({ ...input, trendDays: days }).points.map(({ day }) => day), days);
    const empty = trend({ ...input, trendDays: [] });
    assert.deepEqual(empty.points, []);
    assert.equal(empty.missingDayCount, 0);
    assert.equal(empty.notice, isManual ? "手工记录" : "");
  }
});

test("乱序手工记录覆盖首条之前、记录当日、间隔和尾部，不提前使用未来记录", () => {
  const manualRecords = Object.freeze([
    record("2026-10-04", "400"), record("2026-10-07", "700"),
    record("2026-10-01", "100"), record("2026-10-02", "200"),
  ]);
  const before = structuredClone(manualRecords);
  const model = trend({
    isManual: true, manualRecords,
    trendDays: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"],
  });

  assert.deepEqual(model.points.map(({ amount, manualRecordDay }) => [amount, manualRecordDay]), [
    [null, undefined], ["100", "2026-10-01"], ["200", "2026-10-02"],
    ["200", "2026-10-02"], ["400", "2026-10-04"], ["400", "2026-10-04"],
  ]);
  assert.deepEqual(model.points.map(({ status }) => status), ["incomplete", ...Array(5).fill("complete")]);
  assert.ok(model.points.every(({ observed }) => !observed));
  assert.equal(model.missingDayCount, 0);
  assert.deepEqual(manualRecords, before);
});

test("同日重复的旧手工记录保持原输入首条优先，不按金额或保存时间改选", () => {
  const duplicates = [record("2026-10-01", "0"), {
    ...record("2026-10-01", "999"), recordedAt: "2026-10-02T00:00:00.000Z",
  }];
  for (const ordered of [duplicates, duplicates.toReversed()]) {
    const model = trend({
      isManual: true,
      manualRecords: [record("2026-10-04", "400"), ...ordered],
      trendDays: ["2026-10-01", "2026-10-02"],
    });
    assert.deepEqual(model.points.map(({ amount }) => amount), [ordered[0].amount, ordered[0].amount]);
  }
});

test("手工趋势优先延续记录日已观测的目标币种金额，包括零值", () => {
  const model = trend({
    isManual: true, reportingCurrency: "CNY",
    manualRecords: [record("2026-10-01", "100")],
    history: [
      snapshot("2026-10-01", [source({ kind: "manual", total: { USD: "100", CNY: "0" } })], usdToCny("2026-10-01", "7")),
      snapshot("2026-10-02", [source({ kind: "manual", total: { USD: "100", CNY: "900" } })], usdToCny("2026-10-02", "9")),
    ],
    trendDays: ["2026-10-01", "2026-10-02", "2026-10-03"],
  });

  assert.deepEqual(model.points.map(({ amount, observed }) => [amount, observed]), [["0", true], ["0", false], ["0", false]]);
  assert.equal(model.notice, "手工记录");
  assert.deepEqual(model.unavailablePoints, []);
});

test("手工记录缺少目标币种金额时只用记录日汇率精确折算，不用后续汇率重算", () => {
  for (const sources of [[], [source({ kind: "manual", total: { USD: "0.1", CNY: null } })]]) {
    const model = trend({
      isManual: true, reportingCurrency: "CNY",
      manualRecords: [record("2026-10-01", "0.1")],
      history: [
        snapshot("2026-10-01", sources, usdToCny("2026-10-01", "7.25")),
        snapshot("2026-10-02", [source()], usdToCny("2026-10-02", "9")),
      ],
      trendDays: ["2026-10-01", "2026-10-02", "2026-10-03"],
    });
    assert.deepEqual(model.points.map(({ amount, manualRecordDay }) => [amount, manualRecordDay]), Array(3).fill(["0.725", "2026-10-01"]));
    assert.deepEqual(model.points.map(({ observed }) => observed), [sources.length > 0, false, false]);
    assert.equal(model.notice, "手工记录");
  }
});

test("记录日缺汇率的手工趋势保留未估值，不借后续观测填零或重估", () => {
  const model = trend({
    isManual: true, reportingCurrency: "CNY",
    manualRecords: [record("2026-10-01", "100")],
    history: [
      snapshot("2026-10-01", [source({ kind: "manual", total: { USD: "100", CNY: null } })]),
      snapshot("2026-10-02", [source()], usdToCny("2026-10-02", "9")),
    ],
    trendDays: ["2026-10-01", "2026-10-02", "2026-10-03"],
  });

  assert.deepEqual(model.points.map(({ amount, observed, status }) => [amount, observed, status]), [
    [null, true, "complete"], [null, false, "complete"], [null, false, "complete"],
  ]);
  assert.deepEqual(model.unavailablePoints, model.points.slice(0, 2));
  assert.deepEqual(model.abnormalPoints, []);
  assert.equal(model.missingDayCount, 0);
  assert.equal(model.notice, "手工记录 · 数据受限：2 天未估值");
});

test("同币种手工记录无需历史快照或汇率，保持大额十进制字符串精度", () => {
  const model = trend({
    isManual: true, reportingCurrency: "HKD",
    manualRecords: [record("2026-10-01", "9007199254740993.01", "HKD")],
    trendDays: ["2026-10-01", "2026-10-02"],
  });
  assert.deepEqual(model.points.map(({ amount }) => amount), ["9007199254740993.01", "9007199254740993.01"]);
  assert.equal(model.notice, "手工记录");
});

test("长区间手工趋势不为每个自然日重新扫描和排序全部记录", () => {
  const count = 512;
  const days = Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10)
  );
  let dayReads = 0;
  const manualRecords = days.map((day, index) => ({
    ...record(day, String(index)),
    get day() {
      dayReads += 1;
      return day;
    },
  })).toReversed();
  const model = trend({ isManual: true, manualRecords, trendDays: days });

  // 用日期读取次数约束增长量，避免依赖机器负载和计时精度。
  const budget = 8 * (count + days.length) * Math.ceil(Math.log2(count + 1));
  assert.ok(dayReads < budget, `读取日期 ${dayReads} 次，超过预排序与二分查找预算 ${budget}`);
  assert.deepEqual(model.points.map(({ amount }) => amount), days.map((_, index) => String(index)));
});
