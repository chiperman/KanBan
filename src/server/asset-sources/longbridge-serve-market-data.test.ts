import assert from "node:assert/strict";
import test from "node:test";
import { KeychainLongbridgeOAuth, ServeLongbridgeBenchmarkCandlestickReader, ServeLongbridgeFormalSettlementCandleReader, ServeLongbridgeHoldingCandlestickReader } from "@/server/asset-sources/longbridge";
import { LongbridgeServeMarketData } from "@/server/asset-sources/longbridge-serve-market-data";
import type { AssetSourceSummary, LongbridgeHoldingCandlestickPeriod } from "@/server/ports";

const reference = "macos-keychain:test";
const time = "2026-09-28T04:00:00Z";
const candle = { timestamp: time, open: "100", high: "110", low: "90", close: "105", volume: 1000, turnover: "105000", trade_session: "Intraday" };
const source: AssetSourceSummary = {
  id: "test", kind: "longbridge", label: "长桥", accountId: "test",
  permissions: ["account", "positions", "market-data"], credentialReference: reference, lifecycle: "connected",
  snapshot: { total: { amount: "100", currency: "USD" }, holdings: [], exchangeRates: [], syncedAt: time },
  sync: { status: "current", lastSuccessfulAt: time, lastAttemptAt: time, error: null },
};

function fixture(result: unknown = [candle], error?: Error) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let closes = 0;
  const data = new LongbridgeServeMarketData(() => ({
    async call(method, params = {}) {
      calls.push({ method, params });
      if (error) throw error;
      return result;
    },
    async close() { closes++; },
  }));
  data.credentialReference = () => reference;
  return { data, calls, closes: () => closes };
}

test("两个指数使用 serve 的未复权日 K，不读取 SDK OAuth 或账户资产", async () => {
  const f = fixture();
  const reader = new ServeLongbridgeBenchmarkCandlestickReader(f.data);
  for (const symbol of [".SPX.US", ".NDX.US"] as const) {
    assert.deepEqual(await reader.readDailyCandlesticks({ symbol, count: 1000 }), [{ close: "105", time: "2026-09-28T04:00:00.000Z" }]);
  }
  assert.deepEqual(f.calls, [".SPX.US", ".NDX.US"].map(symbol => ({
    method: "quote.candlesticks", params: { symbol, period: "day", count: 1000, adjust: "none" },
  })));
  assert.equal(f.closes(), 2);
  await assert.rejects(reader.readDailyCandlesticks({ symbol: "AAPL.US" as never, count: 1000 }), /不支持该指数/);
  await assert.rejects(reader.readDailyCandlesticks({ symbol: ".SPX.US", count: 1001 }), /数量/);
  assert.equal(f.calls.length, 2);
});

test("持仓周期统一映射 RPC 周期、数量和 OHLCV 口径", async () => {
  for (const [period, rpcPeriod, count] of [
    ["day", "day", 120], ["week", "week", 104], ["month", "month", 120], ["year", "year", 30], ["min-1", "1m", 240],
  ] as const) {
    const f = fixture();
    const result = await new ServeLongbridgeHoldingCandlestickReader(f.data).readCandlesticks({ source, symbol: "AAPL.US", period: period as LongbridgeHoldingCandlestickPeriod });
    assert.deepEqual(result, [{ time: "2026-09-28T04:00:00.000Z", open: "100", high: "110", low: "90", close: "105", volume: "1000", turnover: "105000" }]);
    assert.deepEqual(f.calls[0].params, { symbol: "AAPL.US", period: rpcPeriod, count, adjust: "none" });
    assert.equal(f.closes(), 1);
  }
});

test("近五日读取 1000 根五分钟 K，按交易所时区保留五天并排序", async () => {
  const rows = [21, 22, 23, 24, 25, 26].flatMap(day => [
    { ...candle, timestamp: "2026-09-" + day + "T23:55:00Z" },
    { ...candle, timestamp: "2026-09-" + (day + 1) + "T00:05:00Z" },
  ]).reverse();
  const f = fixture(rows);
  const result = await new ServeLongbridgeHoldingCandlestickReader(f.data).readFiveDayTrend({ source, symbol: "AAPL.US" });
  assert.equal(result.length, 10);
  assert.equal(result[0].time, "2026-09-22T23:55:00.000Z");
  assert.equal(result.at(-1)?.time, "2026-09-27T00:05:00.000Z");
  assert.deepEqual(f.calls[0].params, { symbol: "AAPL.US", period: "5m", count: 1000, adjust: "none" });
  assert.equal(f.closes(), 1);
});

test("正式日结每个标的取最新常规盘日 K，复用并关闭本次 serve", async () => {
  const f = fixture([candle, { ...candle, timestamp: "2026-09-25T04:00:00Z", close: "99" }]);
  const result = await new ServeLongbridgeFormalSettlementCandleReader(f.data).readDailyCandles({ source, symbols: ["AAPL.US", "700.HK"] });
  assert.deepEqual(result, ["AAPL.US", "700.HK"].map(symbol => ({ symbol, close: "105", timestamp: "2026-09-28T04:00:00.000Z", tradeSession: "intraday" })));
  assert.deepEqual(f.calls.map(call => call.params), ["AAPL.US", "700.HK"].map(symbol => ({ symbol, period: "day", count: 3, adjust: "none" })));
  assert.equal(f.closes(), 1);
});

test("错误来源引用与不支持的标的不启动行情读取", async () => {
  const f = fixture();
  const reader = new ServeLongbridgeHoldingCandlestickReader(f.data);
  await assert.rejects(reader.readCandlesticks({ source: { ...source, credentialReference: "other" }, symbol: "AAPL.US", period: "day" }), /凭证/);
  await assert.rejects(reader.readFiveDayTrend({ source, symbol: "CASH.USD" }), /不支持/);
  await assert.rejects(new ServeLongbridgeFormalSettlementCandleReader(f.data).readDailyCandles({ source: { ...source, kind: "binance" }, symbols: ["AAPL.US"] }), /不支持/);
  assert.equal(f.calls.length, 0);
});

test("拒绝无效行情并关闭 serve", async () => {
  for (const [_label, result] of [
    ["缺少列表", {}], ["盘后", [{ ...candle, trade_session: "Post" }]],
    ["时间", [{ ...candle, timestamp: "invalid" }]], ["价格", [{ ...candle, close: "NaN" }]],
    ["成交量", [{ ...candle, volume: Number.MAX_SAFE_INTEGER + 1 }]],
  ] as const) {
    const f = fixture(result);
    await assert.rejects(new ServeLongbridgeBenchmarkCandlestickReader(f.data).readDailyCandlesticks({ symbol: ".SPX.US", count: 1000 }), /列表|常规盘|格式/);
    assert.equal(f.closes(), 1);
  }
});

test("serve 异常和日结空数据不伪造结果，关闭本次客户端", async () => {
  const f = fixture(undefined, new Error("CLI expired"));
  await assert.rejects(f.data.readFiveDayTrend("AAPL.US", 1000), /CLI expired/);
  assert.equal(f.closes(), 1);
  const empty = fixture([]);
  await assert.rejects(empty.data.readDailyCandles(["AAPL.US"]), /缺少数据/);
  assert.equal(empty.closes(), 1);
});

test("授权后的预览可以只走 serve 快照，不调用失效 SDK 读取", async () => {
  const sdk = {
    authorizationStatus: () => ({ status: "authorized" }),
    credentialReference: () => reference,
    readAssets: async () => { throw new Error("SDK refresh token failed"); },
  };
  let reads = 0;
  const oauth = new KeychainLongbridgeOAuth(sdk as never, async (observedAt) => {
    reads++;
    assert.equal(observedAt, time);
    return source.snapshot;
  });
  assert.equal((await oauth.revalidate({ credentials: reference, observedAt: time })).snapshot, source.snapshot);
  assert.equal(reads, 1);
});
