import assert from "node:assert/strict";
import test from "node:test";
import { LongbridgeTradingCalendar } from "@/server/asset-sources/longbridge-trading-calendar";

function fixture(result: unknown, failure = false) {
  const calls: unknown[] = [];
  let closes = 0;
  const calendar = new LongbridgeTradingCalendar(() => ({
    async call(method, params) {
      calls.push({ method, params });
      if (failure) throw new Error("upstream failed");
      return result;
    },
    async close() { closes++; },
  }));
  return { calendar, calls, closes: () => closes };
}

test("交易日历通过serve读官方完整/半日市集合，A股市场映射CN", async () => {
  const f = fixture({ trading_days: ["2026-11-25", "2026-11-24"], half_trading_days: ["2026-11-27"] });
  assert.deepEqual(await f.calendar.readTradingDays({ market: "US", start: "2026-11-01", end: "2026-11-30" }), {
    tradingDays: ["2026-11-24", "2026-11-25"], halfTradingDays: ["2026-11-27"],
  });
  for (const market of ["SH", "SZ"] as const) {
    await f.calendar.readTradingDays({ market, start: "2026-11-01", end: "2026-11-30" });
  }
  assert.deepEqual(f.calls, ["US", "CN", "CN"].map(market => ({
    method: "quote.trading_days", params: { market, start: "2026-11-01", end: "2026-11-30" },
  })));
  assert.equal(f.closes(), 3);
});

test("日历缺失或无效时拒绝猜测，且释放 CLI", async () => {
  for (const result of [null, {}, { trading_days: [], half_trading_days: null },
    { trading_days: ["2026-11-31"], half_trading_days: [] },
    { trading_days: ["2026-12-01"], half_trading_days: [] }]) {
    const f = fixture(result);
    await assert.rejects(f.calendar.readTradingDays({ market: "HK", start: "2026-11-01", end: "2026-11-30" }), /交易日历/);
    assert.equal(f.closes(), 1);
  }
});

test("合法空日历代表休市，网络失败不会伪装为空日历", async () => {
  const f = fixture({ trading_days: [], half_trading_days: [] });
  assert.deepEqual(await f.calendar.readTradingDays({ market: "US", start: "2026-11-28", end: "2026-11-28" }), {
    tradingDays: [], halfTradingDays: [],
  });
  const broken = fixture(null, true);
  await assert.rejects(broken.calendar.readTradingDays({ market: "US", start: "2026-11-28", end: "2026-11-28" }), /upstream/);
  assert.equal(broken.closes(), 1);
});
