import { buildSnapshotFromPositions } from "@/domain/valuation";
import assert from "node:assert/strict";
import test from "node:test";

import { MarketCloseFormalDailySettlement } from "@/server/formal-daily-settlement";
import type {
  AssetSnapshot,
  AssetSourceSummary,
  AssetSources,
  Clock,
  FormalDailySettlement,
  FormalDailySettlements,
  FormalSettlementCandleReader,
  FormalSettlementSourceCapture,
} from "@/server/ports";

const CAPTURED_AT = "2026-08-05T16:06:00.000Z";

function source(input: {
  id: string;
  kind: string;
  label: string;
  snapshot: AssetSnapshot;
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    accountId: input.kind + ":" + input.id,
    permissions: [],
    credentialReference: input.kind === "manual" ? null : "opaque",
    snapshot: input.snapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: CAPTURED_AT,
      lastAttemptAt: CAPTURED_AT,
      error: null,
    },
  };
}

function snapshot(amount: string, exchangeRates: AssetSnapshot["exchangeRates"] = []): AssetSnapshot {
  return {
    total: { amount, currency: "USD" },
    holdings: [],
    exchangeRates,
    syncedAt: CAPTURED_AT,
  };
}

class FixedSources implements AssetSources {
  constructor(private readonly values: AssetSourceSummary[]) {}

  async list(): Promise<AssetSourceSummary[]> {
    return this.values;
  }

  async replaceAll(): Promise<void> {
    assert.fail("正式日结不得改写实时来源");
  }

  async update(): Promise<void> {
    assert.fail("正式日结不得改写实时来源");
  }
}

class FixedCapture implements FormalSettlementSourceCapture {
  constructor(private readonly values: Map<string, AssetSnapshot>) {}

  async capture(input: { source: AssetSourceSummary }): Promise<AssetSnapshot> {
    return this.values.get(input.source.id)!;
  }
}

class NoCandles implements FormalSettlementCandleReader {
  async readDailyCandles(): Promise<[]> {
    return [];
  }
}

class FixedClock implements Clock {
  now(): Date {
    return new Date(CAPTURED_AT);
  }
}

class RecordedSettlements implements FormalDailySettlements {
  readonly values: FormalDailySettlement[] = [];

  async list(): Promise<FormalDailySettlement[]> {
    return this.values;
  }

  async recordIfAbsent(settlement: FormalDailySettlement): Promise<boolean> {
    this.values.push(settlement);
    return true;
  }
}

function runSettlement(
  sources: AssetSourceSummary[],
  captures = new Map(sources.map((value) => [value.id, value.snapshot])),
) {
  const settlements = new RecordedSettlements();
  const runner = new MarketCloseFormalDailySettlement(
    new FixedSources(sources),
    new FixedClock(),
    settlements,
    new FixedCapture(captures),
    new NoCandles(),
  );
  return runner.run().then(() => settlements.values[0]!);
}

test("正式日结把同一采集批的长桥汇率用于加密来源总额", async () => {
  const settlement = await runSettlement([
    source({
      id: "longbridge-source",
      kind: "longbridge",
      label: "长桥证券",
      snapshot: snapshot("100", [
        {
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "长桥",
          observedAt: CAPTURED_AT,
        },
        {
          baseCurrency: "USD",
          quoteCurrency: "HKD",
          rate: "7.8",
          source: "长桥",
          observedAt: CAPTURED_AT,
        },
      ]),
    }),
    source({
      id: "crypto-source",
      kind: "crypto-fixture",
      label: "加密资产",
      snapshot: snapshot("102"),
    }),
  ]);

  assert.equal(settlement.status, "complete");
  assert.deepEqual(settlement.total, {
    USD: "202",
    CNY: "1454.4",
    HKD: "1575.6",
  });
  assert.deepEqual(settlement.sources[1], {
    sourceId: "crypto-source",
    label: "加密资产",
    kind: "crypto-fixture",
    capturedAt: CAPTURED_AT,
    status: "complete",
    diagnostic: null,
    total: { USD: "102", CNY: "734.4", HKD: "795.6" },
  });
});

test("正式日结没有可用长桥汇率时保留 CNY/HKD 缺失并标记不完整", async () => {
  const settlement = await runSettlement([
    source({
      id: "crypto-source",
      kind: "crypto-fixture",
      label: "加密资产",
      snapshot: snapshot("102"),
    }),
  ]);

  assert.equal(settlement.status, "incomplete");
  assert.equal(settlement.sources[0]?.status, "incomplete");
  assert.deepEqual(settlement.total, {
    USD: "102",
    CNY: null,
    HKD: null,
  });
  assert.deepEqual(settlement.sources[0]?.total, {
    USD: "102",
    CNY: null,
    HKD: null,
  });
});

for (const observedAt of ["2026-08-04T16:06:00.000Z", "2026-08-06T16:06:00.000Z"]) {
  test("正式日结不从实时来源快照借用其他日期汇率：" + observedAt, async () => {
    const longbridge = source({
      id: "longbridge-source",
      kind: "longbridge",
      label: "长桥证券",
      snapshot: snapshot("100", [
        { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2", source: "长桥", observedAt },
        { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8", source: "长桥", observedAt },
      ]),
    });
    const crypto = source({
      id: "crypto-source",
      kind: "crypto-fixture",
      label: "加密资产",
      snapshot: snapshot("102"),
    });
    const settlement = await runSettlement([longbridge, crypto], new Map([
      [longbridge.id, snapshot("100")],
      [crypto.id, crypto.snapshot],
    ]));

    assert.equal(settlement.status, "incomplete");
    assert.deepEqual(settlement.exchangeRates, []);
    assert.deepEqual(settlement.total, { USD: "202", CNY: null, HKD: null });
    assert.equal(settlement.sources[1]?.status, "incomplete");
    assert.deepEqual(settlement.sources[1]?.total, { USD: "102", CNY: null, HKD: null });
  });
}

test("采集异常与行情等待分离，不向执行结果泄露原始错误", async () => {
  const crypto = source({ id: "crypto", kind: "binance", label: "私有来源", snapshot: snapshot("100") });
  const runner = new MarketCloseFormalDailySettlement(new FixedSources([crypto]), new FixedClock(), new RecordedSettlements(), {
    async capture() { throw new Error("token=PRIVATE_PROVIDER_SECRET"); },
  }, new NoCandles());
  assert.deepEqual(await runner.run(), { outcome: "error", reason: "source-read-failed" });
});

test("recorded不代表完整：错过窗口需返回独立日结质量", async () => {
  const crypto = source({ id: "crypto", kind: "binance", label: "test", snapshot: snapshot("100") });
  const runner = new MarketCloseFormalDailySettlement(new FixedSources([crypto]), {
    now: () => new Date("2026-08-06T15:00:00.000Z"),
  }, new RecordedSettlements(), new FixedCapture(new Map()), new NoCandles());
  assert.deepEqual(await runner.run(), { outcome: "recorded", settlementStatus: "missed", reason: "capture-window-missed" });
});

for (const failure of [false, true]) {
  test(failure ? "dailyK原始异常只返回安全错误码" : "dailyK暂无官方行情为waiting而非error", async () => {
    const securitySnapshot = buildSnapshotFromPositions({
      positions: [{ symbol: "NVDA.US", name: "test", quantity: "1", currency: "USD", assetClass: "securities",
        currentPrice: { amount: "100", currency: "USD" }, priceSource: "fixture", pricedAt: "2026-08-05T20:05:00Z",
        costPrice: null, platformProfit: null, changePercent: null }],
      sourceCurrency: "USD", exchangeRates: [], syncedAt: "2026-08-05T20:05:00Z",
    });
    const security = source({ id: "securities", label: "private-name", kind: "longbridge", snapshot: securitySnapshot });
    const settlements = new RecordedSettlements();
    const runner = new MarketCloseFormalDailySettlement(new FixedSources([security]), { now: () => new Date("2026-08-05T20:05:00Z") }, settlements,
      new FixedCapture(new Map([[security.id, securitySnapshot]])), {
        async readDailyCandles() { if (failure) throw new Error("API_SECRET_private"); return []; },
      });
    assert.deepEqual(await runner.run(), failure
      ? { outcome: "error", reason: "candle-read-failed" }
      : { outcome: "waiting", reason: "official-close-pending" });
    assert.deepEqual(settlements.values, []);
  });
}
