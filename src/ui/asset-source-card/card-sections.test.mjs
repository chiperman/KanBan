import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadView } from "./render-test-support.mjs";

const root = process.cwd();
const { AssetSourceCard } = loadView(path.join(root, "src/ui/longbridge-asset-card.tsx"));
const { assetSourceHoldingsModel } = loadView(path.join(root, "src/ui/asset-source-card/holdings-model.ts"));
const observedAt = "2026-10-13T08:00:00.000Z";
const tokenKey = `evm:1:0x${"a".repeat(40)}`;
const rates = [
  { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "测试汇率", observedAt },
  { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "测试汇率", observedAt },
];

export function cardProps(kind = "longbridge", overrides = {}) {
  const valued = {
    symbol: "AAPL.US", name: "Apple", quantity: "2", currency: "USD", assetClass: "securities",
    currentPrice: { amount: "100", currency: "USD" }, marketValue: "200",
    sourceMarketValue: { amount: "200", currency: "USD" }, costPrice: "90", platformProfit: "20", changePercent: null,
    valuation: { status: "valued", priceSource: "测试价格", pricedAt: observedAt },
  };
  const source = {
    id: "render-source", kind, label: "测试账户", displayName: "测试资产", accountId: "test-account",
    snapshot: {
      total: { amount: "1234.56", currency: "USD" }, exchangeRates: rates, syncedAt: observedAt,
      holdings: [valued, {
        ...valued, symbol: "TINY", name: "Tiny", quantity: "0.0025", marketValue: "0.25",
        sourceMarketValue: { amount: "0.25", currency: "USD" }, assetClass: "crypto",
      }, {
        ...valued, symbol: "OPTION.US", name: "Option", marketValue: null, currentPrice: null,
        sourceMarketValue: null, valuation: { status: "quote-unavailable", reason: "行情未接入" },
      }, {
        ...valued, symbol: "UNKNOWN", name: "Unknown", marketValue: null, currentPrice: null,
        sourceMarketValue: null, valuation: { status: "unvalued", reason: "缺少价格" },
      }, {
        ...valued, symbol: "USD", name: "Cash", assetClass: "cash", quantity: "99.12", marketValue: "99.12",
        sourceMarketValue: { amount: "99.12", currency: "USD" },
        cashBalances: [{ amount: "99.12", currency: "USD", availableCash: "90", frozenCash: "9.12", settlingCash: "0", withdrawCash: "90" }],
      }],
      coverage: { status: "complete", products: [], unexplainedValue: null, excludedPositiveAccounts: [] },
      unrecognizedEvmTokens: [{ sourceAsset: tokenKey, symbol: "LOCKED", name: "读取受限", quantity: null, reason: "数量读取失败" }],
    },
    sync: { status: "current", lastSuccessfulAt: observedAt, lastAttemptAt: observedAt, error: null },
    manualRecords: [{ sourceId: "render-source", day: "2026-10-13", amount: "1234.56", currency: "USD", recordedAt: observedAt }],
  };
  const history = [
    { day: "2026-10-12", capturedAt: "2026-10-12T08:00:00.000Z", complete: true, sources: [
      { sourceId: source.id, kind, label: source.label, capturedAt: "2026-10-12T08:00:00.000Z", complete: true, total: { USD: "0", CNY: "0", HKD: "0" } },
    ], total: { USD: "0", CNY: "0", HKD: "0" } },
    { day: "2026-10-13", capturedAt: observedAt, complete: false, status: "expired", sources: [
      { sourceId: source.id, kind, label: source.label, capturedAt: observedAt, complete: true, status: "expired", total: { USD: "1234.56", CNY: "8888.83", HKD: null } },
    ], total: { USD: "1234.56", CNY: "8888.83", HKD: null } },
  ];
  return {
    source, history, reportingExchangeRates: rates, reportingCurrency: "USD",
    trendRange: "7d", currentDay: "2026-10-13", holdingsSearchQuery: "",
    profitColorScheme: "red-up", showSensitiveInfo: true, showRefreshControl: false,
    ...overrides,
  };
}

export function renderCard(props) {
  return renderToStaticMarkup(React.createElement(AssetSourceCard, props));
}

export function renderCases() {
  const cases = [];
  for (const kind of ["longbridge", "binance", "okx", "bitget", "bit", "evm-watch-ethereum", "evm-watch-bsc", "manual"]) {
    for (const reportingCurrency of ["USD", "CNY", "HKD"]) {
      for (const showSensitiveInfo of [true, false]) {
        cases.push([`${kind}-${reportingCurrency}-${showSensitiveInfo}`, cardProps(kind, { reportingCurrency, showSensitiveInfo })]);
      }
    }
  }
  for (const variant of ["expired", "disconnected", "empty", "search", "custom-trend", "included-token", "manual-empty"]) {
    const props = cardProps(variant === "manual-empty" ? "manual" : "longbridge");
    if (variant === "expired") props.source.sync = { ...props.source.sync, status: "expired", error: "测试读取失败" };
    if (variant === "disconnected") props.source.lifecycle = "disconnected";
    if (variant === "empty") props.history = [];
    if (variant === "search") props.holdingsSearchQuery = "no-match";
    if (variant === "custom-trend") { props.trendContent = React.createElement("p", {}, "自定义趋势"); props.showAssetTrend = true; }
    if (variant === "included-token") { props.source.kind = "evm-watch-ethereum"; props.source.includedAssetKeys = [tokenKey]; props.assetScopeHref = "/asset-sources/render-source"; }
    if (variant === "manual-empty") { props.source.hasManualRecord = false; props.source.manualRecords = []; }
    cases.push([variant, props]);
  }
  return cases;
}

export function markupHash(markup) {
  // React useId depends on the component tree; normalize its generated IDs, not business IDs.
  return createHash("sha256").update(markup.replace(/_R_[a-zA-Z0-9]+_/g, "REACT_ID")).digest("hex");
}

test("卡片拆分保持原 DOM、类名、文案和金额的 55 组渲染契约", () => {
  // Frozen from the pre-split card at 5472b69, not generated from the new sections.
  const baseline = JSON.parse(readFileSync(path.join(root, "src/ui/asset-source-card/card-render-baseline.json"), "utf8"));
  const cases = renderCases();
  assert.equal(cases.length, 55);
  assert.deepEqual(cases.map(([name]) => name).sort(), Object.keys(baseline).sort());
  for (const [name, props] of cases) {
    assert.equal(markupHash(renderCard(props)), baseline[name], name);
  }
});

test("卡片区分零值、缺少折算、过期记录及隐私遮蔽，不重估历史", () => {
  const visible = renderCard(cardProps());
  assert.match(visible, /1,234.56/);
  assert.match(visible, /99.12 USD/);
  assert.match(visible, /0.00 USD/);
  assert.match(visible, /过期/);
  const cny = renderCard(cardProps("longbridge", { reportingCurrency: "CNY" }));
  assert.match(cny, /8,888.83 CNY/);
  const hkd = renderCard(cardProps("longbridge", { reportingCurrency: "HKD" }));
  assert.match(hkd, /未估值 · 过期/);
  for (const kind of ["longbridge", "manual"]) {
    const hidden = renderCard(cardProps(kind, { showSensitiveInfo: false }));
    assert.ok(!hidden.includes("1,234.56"));
    assert.ok(!hidden.includes("99.12"));
    assert.ok(!hidden.includes("source-daily-trend-details"));
    assert.match(hidden, /趋势已隐藏/);
  }
});

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return React.Children.toArray(node.props?.children).map((child) => findNode(child, predicate)).find(Boolean);
}

test("手工历史回调传递原来源和记录，演示操作不触发写入", () => {
  const { ManualAssetHistory } = loadView(path.join(root, "src/ui/asset-source-card/manual-asset-history.tsx"));
  const { source } = cardProps("manual");
  const calls = [];
  const props = {
    source, showSensitiveInfo: true, formatAmount: (value) => value,
    onManualAssetRecord: (...args) => calls.push(["edit", ...args]),
    onManualAssetRecordDelete: (...args) => calls.push(["delete", ...args]),
  };
  const action = (tree, label) => findNode(tree, (node) => node.props?.children === label).props.onClick();
  const tree = ManualAssetHistory(props);
  action(tree, "编辑"); action(tree, "删除");
  assert.deepEqual(calls, [["edit", source, source.manualRecords[0]], ["delete", source, source.manualRecords[0]]]);
  let readOnlyCalls = 0;
  const demoTree = ManualAssetHistory({ ...props, onReadOnlyAction: () => { readOnlyCalls += 1; } });
  action(demoTree, "编辑"); action(demoTree, "删除");
  assert.equal(readOnlyCalls, 2);
  assert.equal(calls.length, 2);
});

test("持仓区域保持筛选和展开回调、K线选择以及隐私禁用", () => {
  const { AssetSourceHoldings } = loadView(path.join(root, "src/ui/asset-source-card/source-holdings.tsx"));
  const { HoldingDetailRow } = loadView(path.join(root, "src/ui/asset-source-card/holding-detail-row.tsx"));
  const { source } = cardProps("binance");
  const calls = [];
  const props = {
    source, model: assetSourceHoldingsModel({ source, hideSmallCryptoHoldings: true, holdingsSearchQuery: "" }),
    hideSmallCryptoHoldings: true, holdingsDetailExpanded: true, showSensitiveInfo: true,
    onSmallHoldingFilterChange: (value) => calls.push(value), onToggleHoldingsDetail: () => calls.push("toggle"),
    profitColorScheme: "red-up", formatAmount: (value) => value,
    formatDisplayMoney: (value) => value, formatDisplayPrice: (value) => value,
  };
  const tree = AssetSourceHoldings(props);
  findNode(tree, (node) => node.type === "input").props.onChange({ target: { checked: false } });
  const toggle = findNode(tree, (node) => node.props?.["data-testid"] === "asset-holdings-detail-toggle");
  toggle.props.onClick();
  assert.equal(toggle.props["aria-controls"], "asset-holdings-detail-render-source");
  assert.equal(toggle.props["aria-expanded"], true);
  assert.deepEqual(calls, [false, "toggle"]);
  const selected = () => {};
  const longbridgeSource = { ...source, kind: "longbridge" };
  const longbridgeProps = {
    ...props, source: longbridgeSource, onShowCandlesticks: selected,
    model: assetSourceHoldingsModel({ source: longbridgeSource, hideSmallCryptoHoldings: true, holdingsSearchQuery: "" }),
  };
  const selectRow = (showSensitiveInfo) => findNode(AssetSourceHoldings({ ...longbridgeProps, showSensitiveInfo }),
    (node) => node.type === HoldingDetailRow && node.props.holding.symbol === "AAPL.US");
  assert.equal(selectRow(true).props.onShowCandlesticks, selected);
  assert.equal(selectRow(false).props.onShowCandlesticks, undefined);
});
