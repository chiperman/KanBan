import assert from "node:assert/strict";
import test from "node:test";
import { ServeLongbridgeSourceRefresher } from "@/server/asset-sources/longbridge-serve-assets";
import type { AssetSourceRefresher, AssetSourceSummary } from "@/server/ports";

const identity = { memberId: "123", accountChannel: "channel" };
const at = "2026-09-26T13:00:00.000Z";
const source: AssetSourceSummary = {
  id: "longbridge-test", kind: "longbridge", label: "长桥", accountId: "client-fingerprint",
  permissions: ["account", "positions", "market-data"], credentialReference: "macos-keychain:test", lifecycle: "connected",
  snapshot: { total: { amount: "100", currency: "USD" }, holdings: [], exchangeRates: [], syncedAt: at },
  sync: { status: "current", lastSuccessfulAt: at, lastAttemptAt: at, error: null },
};
const input: Parameters<AssetSourceRefresher["refresh"]>[0] = {
  source, credentials: "macos-keychain:test", mode: "all", attemptedAt: at,
  signal: new AbortController().signal, persistCredentials: async () => { throw new Error("禁止写凭证"); },
};
function fixture(options: { fail?: string; malformed?: string; mismatch?: boolean; switchAccount?: boolean; regular?: boolean; abort?: AbortController } = {}) {
  const calls: string[] = [];
  let closes = 0;
  let identities = 0;
  const data: Record<string, unknown> = {
    "trade.account_balance": [{ currency: "USD", net_assets: "5000", total_cash: "4000", cash_infos: [] }],
    "trade.stock_positions": { list: [{ account_channel: "channel", stock_info: [{ symbol: "700.HK", symbol_name: "腾讯", quantity: "2", currency: "HKD", cost_price: "100" }] }] },
    "trade.fund_positions": { list: [] },
    "api.get": { exchanges: [{ base_currency: "USD", other_currency: "HKD", average_rate: 0.128 }] },
    "quote.quote": [{ symbol: "700.HK", last_done: "500", prev_close: "490", timestamp: "2026-09-26T12:00:00Z", trade_status: "Normal", post_market_quote: { last_done: "510", timestamp: "2026-09-26T12:30:00Z" } }],
  };
  const refresher = new ServeLongbridgeSourceRefresher(
    { credentialReference: () => "macos-keychain:test", accountIdentity: () => identity },
    () => ({ call: async (method: string) => {
      calls.push(method);
      if (options.abort) options.abort.abort();
      if (options.fail === method) throw new Error("CLI failed");
      const value = structuredClone(data[method]);
      if (options.regular && method === "quote.quote") (value as Record<string, unknown>[])[0].post_market_quote = null;
      return options.malformed === method ? {} : value;
    }, close: async () => { closes++; } }),
    async () => {
      identities++;
      return options.mismatch || (options.switchAccount && identities > 1) ? { ...identity, memberId: "456" } : identity;
    },
  );
  return { refresher, calls, closes: () => closes };
}

test("serve 完整读取按盘外报价加现金计算总资产，并保留账户原值与官方汇率", async () => {
  const f = fixture();
  const { snapshot } = await f.refresher.refresh(input);
  assert.equal(f.closes(), 1);
  assert.equal(snapshot.total.amount, "4130.56");
  assert.deepEqual(snapshot.longbridgeValuation, {
    basis: "latest-quotes", reportedTotal: { amount: "5000", currency: "USD" }, reportedAt: at,
  });
  assert.equal(snapshot.holdings.length, 2);
  assert.equal(snapshot.holdings.find(h => h.assetClass === "cash")?.marketValue, "4000");
  const stock = snapshot.holdings.find(h => h.symbol === "700.HK")!;
  assert.equal(stock.currentPrice?.amount, "510");
  assert.equal(stock.previousClose?.amount, "490");
  assert.equal(stock.sourceMarketValue?.amount, "130.56");
  assert.equal(stock.quoteEvidence?.quotedAt, "2026-09-26T12:30:00.000Z");
  assert.deepEqual(snapshot.exchangeRates[0], { baseCurrency: "HKD", quoteCurrency: "USD", rate: "0.128", source: "Longbridge 官方账户汇率", observedAt: at });
});

test("serve 失败直接保留错误，不再调用 SDK 回退", async () => {
  const f = fixture({ fail: "trade.account_balance" });
  await assert.rejects(f.refresher.refresh(input), /CLI failed/);
});

for (const method of ["trade.account_balance", "trade.stock_positions", "trade.fund_positions", "api.get", "quote.quote"]) {
  test(method + " 失败直接抛错且关闭 serve", async () => {
    const f = fixture({ fail: method });
    await assert.rejects(f.refresher.refresh(input), /CLI|账户|列表|格式|字段/);
    assert.equal(f.closes(), 1);
  });
  test(method + " 缺失列表不能当成空账户成功", async () => {
    const f = fixture({ malformed: method });
    await assert.rejects(f.refresher.refresh(input), /CLI|账户|列表|格式|字段/);
  });
}

test("不同账户拒绝读取 CLI 资产", async () => {
  const f = fixture({ mismatch: true });
  await assert.rejects(f.refresher.refresh(input), /CLI|账户|列表|格式|字段/);
  assert.deepEqual(f.calls, []);
});

test("CLI Normal 正确映射常规盘口径", async () => {
  const f = fixture({ regular: true });
  const { snapshot } = await f.refresher.refresh(input);
  const stock = snapshot.holdings.find(h => h.symbol === "700.HK")!;
  assert.equal(stock.currentPrice?.amount, "500");
  assert.equal(stock.quoteEvidence?.session, "regular");
});

test("读取中账户切换丢弃 CLI 结果", async () => {
  const f = fixture({ switchAccount: true });
  await assert.rejects(f.refresher.refresh(input), /CLI|账户|列表|格式|字段/);
});

test("serve 失败原快照不变", async () => {
  const before = structuredClone(source.snapshot);
  const f = fixture({ fail: "trade.account_balance" });
  await assert.rejects(f.refresher.refresh(input), /CLI failed/);
  assert.deepEqual(source.snapshot, before);
  assert.equal(f.closes(), 1);
});

test("取消关闭本次 serve，不启动 SDK 回退", async () => {
  const controller = new AbortController();
  const f = fixture({ abort: controller });
  await assert.rejects(f.refresher.refresh({ ...input, signal: controller.signal }), { name: "AbortError" });
  assert.ok(f.closes() >= 1);
});

test("价格刷新按行情与已有汇率更新总资产，保留账户原值且不读取资产接口", async () => {
  const f = fixture();
  const full = await f.refresher.refresh(input);
  const g = fixture();
  const result = await g.refresher.refresh({ ...input, source: { ...source, snapshot: full.snapshot }, mode: "prices" });
  assert.equal(result.snapshot.total.amount, "4130.56");
  assert.equal(result.snapshot.holdings.find(h => h.symbol === "700.HK")?.sourceMarketValue?.amount, "130.56");
  assert.deepEqual(result.snapshot.longbridgeValuation, full.snapshot.longbridgeValuation);
  assert.deepEqual(g.calls, ["quote.quote"]);
});

test("授权预览复用 serve 完整快照与账户校验", async () => {
  const f = fixture();
  assert.equal((await f.refresher.readSnapshot(at)).total.amount, "4130.56");
  assert.equal(f.closes(), 1);
  const mismatched = fixture({ mismatch: true });
  await assert.rejects(mismatched.refresher.readSnapshot(at), /账户不一致/);
  assert.equal(mismatched.calls.length, 0);
});
