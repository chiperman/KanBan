import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadView } from "./render-test-support.mjs";

const root = process.cwd();

const { HoldingDetailRow } = loadView(path.join(root, "src/ui/asset-source-card/holding-detail-row.tsx"));
const holding = {
  symbol: "AAPL.US", name: "Apple", quantity: "12345", currency: "USD",
  assetClass: "securities", currentPrice: { amount: "67890", currency: "USD" },
  previousClose: { amount: "67800", currency: "USD" }, costPrice: "65000",
  marketValue: "838102050", sourceMarketValue: null, platformProfit: "987654", changePercent: null,
  valuation: { status: "valued", priceSource: "Longbridge 行情", pricedAt: "2026-10-01T01:00:00Z" },
};
const defaults = {
  holding, compactProfitColumns: true, showSensitiveInfo: true, showPlatformProfit: true,
  profitColorScheme: "red-up-green-down",
  formatDisplayMoney: (value, currency) => `${value} ${currency}`,
  formatDisplayPrice: (value, currency) => `${value} ${currency}`,
};
function render(props) {
  return renderToStaticMarkup(React.createElement("table", {},
    React.createElement("tbody", {}, React.createElement(HoldingDetailRow, { ...defaults, ...props }))));
}

test("持仓明细展开与紧凑列保持列数、隐私掩码和中性颜色", () => {
  for (const compactProfitColumns of [false, true]) {
    const visible = render({ compactProfitColumns });
    assert.equal((visible.match(/<td\b/g) ?? []).length, compactProfitColumns ? 5 : 8);
    assert.match(visible, /67890 USD/);
    const hidden = render({ compactProfitColumns, showSensitiveInfo: false });
    for (const value of ["12345", "67890", "65000", "838102050", "987654"]) {
      assert.ok(!hidden.includes(value));
    }
    assert.match(hidden, /••••••/);
    assert.ok(!hidden.includes('data-profit-direction="positive"'));
    assert.ok(!hidden.includes('data-profit-direction="negative"'));
    assert.equal((hidden.match(/data-profit-direction="neutral"/g) ?? []).length, 2);
  }
  assert.equal((render({ compactProfitColumns: false, showPlatformProfit: false }).match(/<td\b/g) ?? []).length, 7);
});

test("报价与折算缺失保持真实降级，K线回调传递原持仓", () => {
  assert.match(render({ formatDisplayMoney: () => null, formatDisplayPrice: () => null }), /无法折算/);
  assert.match(render({ holding: {
    ...holding, marketValue: null, currentPrice: null, costPrice: null,
    valuation: { status: "quote-unavailable", reason: "报价未接入" },
  } }), /期权行情未接入/);
  assert.match(render({ holding: {
    ...holding, marketValue: null, currentPrice: null, costPrice: null,
    valuation: { status: "unvalued", reason: "缺少报价" },
  } }), /未估值/);
  let selected = null;
  const tree = HoldingDetailRow({ ...defaults, onShowCandlesticks: (value) => { selected = value; } });
  const findTrigger = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.props?.className === "holding-candlestick-trigger") return node;
    return React.Children.toArray(node.props?.children).map(findTrigger).find(Boolean);
  };
  findTrigger(tree).props.onClick();
  assert.equal(selected, holding);
  assert.ok(!render({}).includes("holding-candlestick-trigger"));
});
