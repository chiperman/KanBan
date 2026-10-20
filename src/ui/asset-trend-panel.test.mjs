import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadView } from "./asset-source-card/render-test-support.mjs";

const { AssetTrendPanel, useAssetTrendRange } = loadView(path.resolve("src/ui/asset-trend-panel.tsx"));
const points = [
  { day: "2026-03-01", amount: "0", observed: true, status: "complete" },
  { day: "2026-03-02", amount: null, observed: false, status: "incomplete" },
  { day: "2026-03-03", amount: null, observed: true, status: "expired" },
];
function Panel({ hidden = false, values = points, presentation = "default" }) {
  const selection = useAssetTrendRange();
  return React.createElement(AssetTrendPanel, {
    range: { ...selection, currentDay: "2026-03-04", firstDay: "2026-03-01" },
    ariaLabel: "测试资产趋势", currency: "USD", formatAmount: value => value,
    formatDay: value => value, points: values, isSensitiveHidden: hidden,
    rangePresentation: presentation, title: "资产走势",
  });
}
const render = element => renderToStaticMarkup(element);

test("共享趋势默认全部历史，空数据也提供完整区间选择", () => {
  for (const values of [points, []]) {
    const markup = render(React.createElement(Panel, { values }));
    for (const label of ["近 7 日", "本月", "近 1 月", "近半年", "本年", "近 1 年", "全部", "自定义"]) {
      assert.match(markup, new RegExp(`>${label}</button>`));
    }
    assert.match(markup, /<button[^>]*aria-pressed="true"[^>]*>全部<\/button>/);
    assert.equal((markup.match(/aria-pressed="true"/g) ?? []).length, 1);
  }
});

test("共享趋势区分零、缺测、未估值与隐私，不泄露实际记录覆盖", () => {
  const markup = render(React.createElement(Panel, { presentation: "quiet" }));
  assert.match(markup, /实际记录 03月01日 至 03月03日/);
  assert.match(markup, /完整 1 \/ 3 天/);
  assert.match(markup, /1 天不完整或过期/);
  assert.match(markup, /1 天未估值/);
  assert.match(markup, /缺少 1 天观测/);
  const hidden = render(React.createElement(Panel, { hidden: true, presentation: "quiet" }));
  assert.match(hidden, /趋势已隐藏/);
  for (const text of ["实际记录", "完整 1", "天未估值", "缺少 1"]) assert.ok(!hidden.includes(text));
});

test("首页紧凑呈现仅展示一个区间入口，覆盖明细折叠但不丢失", () => {
  const markup = render(React.createElement(Panel, { presentation: "compact" }));
  assert.match(markup, /<h2>资产走势<\/h2>/);
  assert.match(markup, /全部历史/);
  assert.equal((markup.match(/aria-haspopup="listbox"/g) ?? []).length, 1);
  assert.ok(!markup.includes("aria-pressed"));
  assert.match(markup, /<details class="asset-trend-coverage">/);
  assert.match(markup, /存在缺测或不完整记录/);
  assert.match(markup, /完整 1 \/ 3 天/);
  assert.match(markup, /实际记录 03月01日 至 03月03日/);
  const hidden = render(React.createElement(Panel, { presentation: "compact", hidden: true }));
  assert.ok(!hidden.includes("asset-trend-coverage"));
  assert.match(hidden, /趋势已隐藏/);
});

test("紧凑区间的自定义选择保留日期和重新编辑入口", () => {
  const markup = render(React.createElement(AssetTrendPanel, {
    range: { preset: "custom", customRange: { startDay: "2026-03-01", endDay: "2026-03-03" }, currentDay: "2026-03-04", onChange() {} },
    rangePresentation: "compact", ariaLabel: "测试", currency: "USD", formatAmount: value => value,
    formatDay: value => value, points,
  }));
  assert.match(markup, /修改日期/);
  assert.match(markup, /2026-03-01 至 2026-03-03/);
});

test("手动沿用记录不是缺测，缺少折算仍明确未估值", () => {
  const values = [
    { ...points[0], manualRecordDay: "2026-03-01", observed: false },
    { ...points[1], manualRecordDay: "2026-03-01", amount: "0", status: "complete" },
    { ...points[2], manualRecordDay: "2026-03-03", observed: false },
  ];
  const markup = render(React.createElement(Panel, { values }));
  assert.match(markup, /完整 2 \/ 3 天/);
  assert.match(markup, /1 天未估值/);
  assert.ok(!markup.includes("缺少 1 天观测"));
});
