import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { XAxis, LineChart } from "recharts";
import { loadView } from "./asset-source-card/render-test-support.mjs";

const { AssetTrendChart, AssetTrendDateTick, CompactAssetTrendDateTick, CalendarAssetTrendXAxis, calendarAssetTrendTicks } = loadView(path.resolve("src/ui/asset-trend-chart.tsx"));
function nodes(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
}
function chart(benchmark, options = {}) {
  return AssetTrendChart({ ariaLabel: "测试", currency: "%", formatAmount: value => value, formatDay: day => day.slice(5),
    incompleteCount: 0, unavailableCount: 0, benchmark,
    points: [{ day: "2025-12-31", amount: "0", observed: true, status: "complete" }, { day: "2026-01-01", amount: "10", observed: true, status: "complete" }], ...options });
}
const benchmark = { assetScopeLabel: "美股", enabledSymbols: [".SPX.US"], comparison: {
  reason: null, baselineDay: "2025-12-31", points: [
    { day: "2025-12-31", assets: "0", ".SPX.US": "0", ".NDX.US": null },
    { day: "2026-01-01", assets: null, ".SPX.US": "0.1", ".NDX.US": null },
  ],
} };

test("普通与对比折线轴跨年保留年份，tooltip显示完整年月日", () => {
  for (const comparison of [undefined, benchmark]) {
    const tree = nodes(chart(comparison));
    const axis = tree.find(node => node.type === XAxis);
    assert.equal(axis.props.tickFormatter("2025-12-31"), "2025-12-31");
    assert.equal(axis.props.tick, AssetTrendDateTick);
    const tooltip = tree.find(node => typeof node.props.content === "function");
    const point = comparison ? { day: "2025-12-31", assets: 0, amount: "0", ".SPX.US": 0 } : { day: "2025-12-31", amount: "0", historicalAmount: null, status: "complete" };
    const markup = renderToStaticMarkup(tooltip.props.content({ active: true, payload: [{ payload: point }] }));
    assert.match(markup, /2025年12月31日/);
    if (comparison) {
      assert.match(markup, /我的美股资产/);
    }
  }
});

test("首尾日期刻度向内对齐，单刻度居中，缺失资产不转成零", () => {
  for (const [index, count, anchor] of [[0, 3, "start"], [1, 3, "middle"], [2, 3, "end"], [0, 1, "middle"]]) {
    const markup = renderToStaticMarkup(React.createElement(AssetTrendDateTick, { index, visibleTicksCount: count, payload: { value: "2026-10-19" }, x: 100, y: 100 }));
    assert.match(markup, new RegExp(`text-anchor="${anchor}"`));
  }
  const lineChart = nodes(chart(benchmark)).find(node => node.type === LineChart);
  assert.equal(lineChart.props.data[1].assets, null);
});

test("仅紧凑轴启用日历刻度，保留全部观测与完整日期提示", () => {
  const points = Array.from({ length: 12 }, (_, index) => ({
    day: `2026-01-${String(index + 1).padStart(2, "0")}`,
    amount: index === 5 ? null : String(index),
    observed: index !== 5,
    status: index === 5 ? "incomplete" : "complete",
  }));
  for (const comparison of [undefined, benchmark]) {
    const tree = nodes(chart(comparison, { dateAxisPresentation: "compact", points }));
    const axis = tree.find(node => node.type === CalendarAssetTrendXAxis);
    assert.deepEqual(axis.props.points, points);
    assert.equal(tree.some(node => node.type === XAxis), false);
    const data = tree.find(node => node.type === LineChart).props.data;
    assert.equal(data.length, points.length);
    assert.equal(data[0].amount, "0");
    assert.equal(data[5].amount, null);
  }
  const tree = nodes(chart(undefined, { dateAxisPresentation: "compact" }));
  const tooltip = tree.find(node => typeof node.props.content === "function");
  assert.match(renderToStaticMarkup(tooltip.props.content({ active: true, payload: [{ payload: {
    day: "2025-12-31", amount: "0", historicalAmount: null, status: "complete",
  } }] })), /2025年12月31日/);
});

function daysBetween(first, last) {
  return Array.from({ length: (Date.parse(last) - Date.parse(first)) / 86_400_000 + 1 }, (_, index) =>
    new Date(Date.parse(first) + index * 86_400_000).toISOString().slice(0, 10));
}

test("宽图按自然月排刻度，年只标在开头和一月，不在末尾重复", () => {
  const ticks = calendarAssetTrendTicks(daysBetween("2025-05-12", "2026-10-20"), 1000);
  assert.ok(ticks.length > 12);
  assert.equal(ticks[0].day, "2025-05-12");
  assert.ok(ticks.slice(1).every(tick => tick.day.endsWith("-01")));
  assert.deepEqual(ticks.filter(tick => tick.year).map(tick => [tick.day, tick.year]), [
    ["2025-05-12", "2025"], ["2026-01-01", "2026"],
  ]);
  assert.equal(ticks.at(-1).label, "10月");
  for (const [index, dateTick] of ticks.entries()) {
    const markup = renderToStaticMarkup(React.createElement(CompactAssetTrendDateTick, {
      dateTicks: ticks, index, visibleTicksCount: ticks.length,
      payload: { value: dateTick.day }, x: 100, y: 100,
    }));
    assert.ok(markup.includes(`>${dateTick.label}</tspan>`));
    assert.equal(markup.includes(`>${dateTick.day.slice(0, 4)}</tspan>`), dateTick.year !== null);
  }
});

test("按实际宽度调整为逐月、隔月或季度，缩放后仍保留跨年位置", () => {
  const days = daysBetween("2025-05-12", "2026-10-20");
  const wide = calendarAssetTrendTicks(days, 1000);
  const nearMonthlyThreshold = calendarAssetTrendTicks(days, 770);
  const medium = calendarAssetTrendTicks(days, 520);
  const narrow = calendarAssetTrendTicks(days, 280);
  assert.ok(wide.length > medium.length && medium.length > narrow.length);
  assert.deepEqual(nearMonthlyThreshold.map(tick => tick.day), medium.map(tick => tick.day));
  assert.ok(medium.slice(1).every(tick => Number(tick.day.slice(5, 7)) % 2 === 1));
  assert.ok(narrow.slice(1).every(tick => Number(tick.day.slice(5, 7)) % 3 === 1));
  for (const ticks of [wide, medium, narrow]) {
    assert.ok(ticks.some(tick => tick.day === "2026-01-01" && tick.year === "2026"));
    assert.equal(ticks[0].year, "2025");
  }
  assert.deepEqual(calendarAssetTrendTicks(days, 1000), wide);
});

test("短区间保留月日，跨年提示随刻度而非末尾，边界避免重复挤在一起", () => {
  const sameYear = calendarAssetTrendTicks(daysBetween("2026-10-01", "2026-10-20"), 1000);
  assert.ok(sameYear.length > 5);
  assert.equal(sameYear[0].label, "10.01");
  assert.equal(sameYear.at(-1).label, "10.20");
  assert.deepEqual(sameYear.filter(tick => tick.year).map(tick => tick.year), ["2026"]);
  const acrossYears = calendarAssetTrendTicks(daysBetween("2025-12-01", "2026-01-20"), 500);
  assert.ok(acrossYears.some(tick => tick.day === "2026-01-01" && tick.year === "2026"));
  assert.equal(acrossYears.at(-1).year, null);
  const startsNearMonthEnd = calendarAssetTrendTicks(daysBetween("2025-05-30", "2026-01-20"), 600);
  assert.equal(startsNearMonthEnd[0].day, "2025-05-30");
  assert.equal(startsNearMonthEnd[1].day, "2025-07-01");
});

test("紧凑横轴少量或空数据安全", () => {
  for (const count of [1, 2, 3]) {
    const points = Array.from({ length: count }, (_, index) => ({
      day: `2026-01-0${index + 1}`, amount: "0", observed: true, status: "complete",
    }));
    const ticks = calendarAssetTrendTicks(points.map(point => point.day), 300);
    assert.equal(ticks.length, count);
    assert.equal(ticks[0].year, "2026");
  }
  assert.deepEqual(calendarAssetTrendTicks([], 300), []);
  assert.doesNotThrow(() => calendarAssetTrendTicks(["2026-01-01"], 0));
  assert.doesNotThrow(() => chart(undefined, { dateAxisPresentation: "compact", points: [] }));
});

test("旧来源调用不新增覆盖提示，共享面板仍可显式展示覆盖", () => {
  const legacy = renderToStaticMarkup(chart(undefined, { variant: "source" }));
  assert.ok(!legacy.includes("asset-trend-comparison-header"));
  assert.ok(!legacy.includes("asset-trend-quality"));
  const shared = renderToStaticMarkup(chart(undefined, { variant: "source", coverageNote: "实际记录" }));
  assert.match(shared, /asset-trend-quality/);
  const compact = renderToStaticMarkup(chart(undefined, { variant: "source", coveragePresentation: "disclosure" }));
  assert.match(compact, /asset-trend-coverage/);
});
