import assert from "node:assert/strict";
import test from "node:test";
import { ServeFirstLongbridgeSourceRefresher } from "@/server/asset-sources/longbridge-serve-assets";
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
function fixture(options: { fail?: string; malformed?: string; mismatch?: boolean; switchAccount?: boolean; sdkFails?: boolean; regular?: boolean; abort?: AbortController } = {}) {
  const calls: string[] = [];
  let sdkCalls = 0;
  let closes = 0;
  let identities = 0;
  const data: Record<string, unknown> = {
    "trade.account_balance": [{ currency: "USD", net_assets: "5000", total_cash: "4000", cash_infos: [] }],
    "trade.stock_positions": { list: [{ account_channel: "channel", stock_info: [{ symbol: "700.HK", symbol_name: "腾讯", quantity: "2", currency: "HKD", cost_price: "100" }] }] },
    "trade.fund_positions": { list: [] },
    "api.get": { exchanges: [{ base_currency: "USD", other_currency: "HKD", average_rate: 0.128 }] },
    "quote.quote": [{ symbol: "700.HK", last_done: "500", prev_close: "490", timestamp: "2026-09-26T12:00:00Z", trade_status: "Normal", post_market_quote: { last_done: "510", timestamp: "2026-09-26T12:30:00Z" } }],
  };
  const refresher = new ServeFirstLongbridgeSourceRefresher(
    { credentialReference: () => "macos-keychain:test", accountIdentity: () => identity },
    { refresh: async () => {
      sdkCalls++;
      if (options.sdkFails) throw new Error("SDK refresh token failed");
      return { snapshot: { ...source.snapshot, total: { amount: "1234", currency: "USD" } } };
    } },
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
  return { refresher, calls, sdkCalls: () => sdkCalls, closes: () => closes };
}

test("serve 完整成功绕过失效 SDK，保留账户权威总额、现金、盘外报价及官方汇率", async () => {
  const f = fixture({ sdkFails: true });
  const { snapshot } = await f.refresher.refresh(input);
  assert.equal(f.sdkCalls(), 0);
  assert.equal(f.closes(), 1);
  assert.equal(snapshot.total.amount, "5000");
  assert.equal(snapshot.holdings.length, 2);
  assert.equal(snapshot.holdings.find(h => h.assetClass === "cash")?.marketValue, "4000");
  const stock = snapshot.holdings.find(h => h.symbol === "700.HK")!;
  assert.equal(stock.currentPrice?.amount, "510");
  assert.equal(stock.previousClose?.amount, "490");
  assert.equal(stock.sourceMarketValue?.amount, "130.56");
  assert.equal(stock.quoteEvidence?.quotedAt, "2026-09-26T12:30:00.000Z");
  assert.deepEqual(snapshot.exchangeRates[0], { baseCurrency: "HKD", quoteCurrency: "USD", rate: "0.128", source: "Longbridge 官方账户汇率", observedAt: at });
});

for (const method of ["trade.account_balance", "trade.stock_positions", "trade.fund_positions", "api.get", "quote.quote"]) {
  test(method + " 失败由 SDK 独立完整回退", async () => {
    const f = fixture({ fail: method });
    assert.equal((await f.refresher.refresh(input)).snapshot.total.amount, "1234");
    assert.equal(f.sdkCalls(), 1);
    assert.equal(f.closes(), 1);
  });
  test(method + " 缺失列表不能当成空账户成功", async () => {
    const f = fixture({ malformed: method });
    assert.equal((await f.refresher.refresh(input)).snapshot.total.amount, "1234");
    assert.equal(f.sdkCalls(), 1);
  });
}

test("不同账户不读取 CLI 资产，改用已绑定的 SDK", async () => {
  const f = fixture({ mismatch: true });
  assert.equal((await f.refresher.refresh(input)).snapshot.total.amount, "1234");
  assert.deepEqual(f.calls, []);
});

test("CLI Normal 与 SDK NORMAL 使用相同常规盘口径", async () => {
  const f = fixture({ regular: true, sdkFails: true });
  const { snapshot } = await f.refresher.refresh(input);
  const stock = snapshot.holdings.find(h => h.symbol === "700.HK")!;
  assert.equal(stock.currentPrice?.amount, "500");
  assert.equal(stock.quoteEvidence?.session, "regular");
});

test("读取中账户切换丢弃 CLI 结果", async () => {
  const f = fixture({ switchAccount: true });
  assert.equal((await f.refresher.refresh(input)).snapshot.total.amount, "1234");
  assert.equal(f.sdkCalls(), 1);
});

test("两条通道都失败则抛错，原快照不变", async () => {
  const before = structuredClone(source.snapshot);
  const f = fixture({ fail: "trade.account_balance", sdkFails: true });
  await assert.rejects(f.refresher.refresh(input), /SDK refresh token failed/);
  assert.deepEqual(source.snapshot, before);
  assert.equal(f.closes(), 1);
});

test("取消关闭本次 serve，不启动 SDK 回退", async () => {
  const controller = new AbortController();
  const f = fixture({ abort: controller });
  await assert.rejects(f.refresher.refresh({ ...input, signal: controller.signal }), { name: "AbortError" });
  assert.equal(f.sdkCalls(), 0);
  assert.ok(f.closes() >= 1);
});

test("价格刷新保持账户总额，不读取资产接口", async () => {
  const f = fixture();
  const full = await f.refresher.refresh(input);
  const g = fixture({ sdkFails: true });
  const result = await g.refresher.refresh({ ...input, source: { ...source, snapshot: full.snapshot }, mode: "prices" });
  assert.equal(result.snapshot.total.amount, "5000");
  assert.deepEqual(g.calls, ["quote.quote"]);
  assert.equal(g.sdkCalls(), 0);
});
