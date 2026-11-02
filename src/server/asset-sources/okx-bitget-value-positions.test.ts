import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceSummary,
  PriceQuote,
  Prices,
} from "@/server/ports";
import { ProductionBitgetSourceRefresher } from "@/server/asset-sources/bitget";
import { ProductionOkxSourceRefresher } from "@/server/asset-sources/okx";

const API_KEY = "boundary-production-api-key";
const API_SECRET = "boundary-production-secret-must-not-leak";
const PASSPHRASE = "boundary-production-passphrase";

/** 报价时效以 observedAt 为中心取绝对值，用例用真实当前时间避免时钟漂移。 */
function observedNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: "0", data, msg: "", message: "" }), {
    headers: { "content-type": "application/json" },
  });
}

function bitgetResponse(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: "00000", data, msg: "success", requestTime: Date.now() }),
    { headers: { "content-type": "application/json" } },
  );
}

function noReferencePrices(): Prices {
  return { quote: async () => null };
}

function usdtReferencePrices(observedAt: string): Prices {
  const quote: PriceQuote = {
    symbol: "USDT",
    currency: "USD",
    price: "1",
    quotedAt: new Date(observedAt),
  };
  return { quote: async (symbol) => (symbol === "USDT" ? quote : null) };
}

function holding(input: Partial<AssetHolding> & Pick<AssetHolding, "symbol">): AssetHolding {
  return {
    name: `${input.symbol} 持仓`,
    quantity: "1",
    currency: "USDT",
    assetClass: "crypto",
    currentPrice: null,
    marketValue: null,
    sourceMarketValue: null,
    valuation: { status: "unvalued", reason: "测试未估值" },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
    ...input,
  };
}

function snapshot(input: Partial<AssetSnapshot> & Pick<AssetSnapshot, "holdings">): AssetSnapshot {
  return {
    total: { amount: "0", currency: "USDT" },
    exchangeRates: [],
    syncedAt: observedNow(),
    ...input,
  };
}

function source(input: {
  kind: AssetSourceSummary["kind"];
  snapshot: AssetSnapshot;
}): AssetSourceSummary {
  return {
    id: `${input.kind}-source`,
    kind: input.kind,
    label: `${input.kind} 来源`,
    accountId: `${input.kind}-account`,
    permissions: ["market-data", "account", "positions"],
    credentialReference: "credential-reference",
    snapshot: input.snapshot,
    sync: {
      status: "current",
      lastSuccessfulAt: observedNow(),
      lastAttemptAt: observedNow(),
      error: null,
    },
  };
}

// ---------- OKX ----------

function okxFetch(input: {
  observedAt: string;
  instruments?: unknown[];
  tickers?: unknown[];
}): (request: string | URL | Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.toString()).pathname;
    if (path === "/api/v5/public/instruments") {
      return response(input.instruments ?? []);
    }
    if (path === "/api/v5/market/tickers") {
      return response(input.tickers ?? []);
    }
    throw new Error(`意外 OKX 请求：${path}`);
  };
}

function okxOkxCredentials(): string {
  return JSON.stringify({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    passphrase: PASSPHRASE,
    region: "global",
  });
}

function okxInstrument(asset: string): unknown {
  return {
    instType: "SPOT",
    instId: `${asset}-USDT`,
    state: "live",
    baseCcy: asset,
    quoteCcy: "USDT",
  };
}

function okxUsdtUsdInstrument(): unknown {
  return {
    instType: "SPOT",
    instId: "USDT-USD",
    state: "live",
    baseCcy: "USDT",
    quoteCcy: "USD",
  };
}

function okxTicker(instrument: string, price: string, quotedAt: string): unknown {
  return {
    instId: instrument,
    last: price,
    ts: String(Date.parse(quotedAt)),
  };
}

function okxRefresher(prices: Prices, request: ReturnType<typeof okxFetch>) {
  return new ProductionOkxSourceRefresher(prices, request as never);
}

function okxPositionHolding(input: {
  asset: string;
  quantity: string;
  positionId: string;
}): AssetHolding {
  return holding({
    symbol: input.asset,
    sourceAsset: input.asset,
    sourceAccount: "spot",
    providerPositionId: input.positionId,
    quantity: input.quantity,
  });
}

async function refreshOkxPrices(input: {
  prices: Prices;
  previous: AssetSnapshot;
  instruments: unknown[];
  tickers: unknown[];
  coverage?: AssetSnapshot["coverage"];
}): Promise<AssetSnapshot> {
  const observedAt = observedNow();
  const refresher = okxRefresher(input.prices, okxFetch({
    observedAt,
    instruments: input.instruments,
    tickers: input.tickers,
  }));
  const result = await refresher.refresh({
    source: source({ kind: "okx", snapshot: input.previous }),
    credentials: okxOkxCredentials(),
    mode: "prices",
    attemptedAt: observedAt,
    signal: new AbortController().signal,
    persistCredentials: async () => undefined,
  });
  return result.snapshot;
}

test("OKX 行情刷新在缺少报价时不把来源持仓估值归零", async () => {
  const previous = snapshot({
    holdings: [
      okxPositionHolding({ asset: "BTC", quantity: "0.5", positionId: "btc-1" }),
    ],
  });
  const next = await refreshOkxPrices({
    prices: usdtReferencePrices(observedNow()),
    previous,
    instruments: [okxInstrument("BTC"), okxUsdtUsdInstrument()],
    tickers: [],
  });
  const [btc] = next.holdings;
  assert.equal(btc.sourceAsset, "BTC");
  assert.equal(btc.currentPrice, null);
  assert.equal(btc.marketValue, null);
  assert.equal(btc.sourceMarketValue, null);
  assert.deepEqual(btc.valuation, {
    status: "unvalued",
    reason: "OKX 没有可靠的 BTC-USDT 现货价格",
  });
  assert.deepEqual(next.total, { amount: "0", currency: "USDT" });
});

test("OKX 行情刷新丢弃超过五分钟的过期报价，不产出估值", async () => {
  const previous = snapshot({
    holdings: [
      okxPositionHolding({ asset: "ETH", quantity: "2", positionId: "eth-1" }),
    ],
  });
  const next = await refreshOkxPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [okxInstrument("ETH"), okxUsdtUsdInstrument()],
    tickers: [okxTicker("ETH-USDT", "3000", observedNow(-6 * 60_000))],
  });
  const [eth] = next.holdings;
  assert.equal(eth.currentPrice, null);
  assert.deepEqual(eth.valuation, {
    status: "unvalued",
    reason: "OKX 没有可靠的 ETH-USDT 现货价格",
  });
  assert.deepEqual(next.total, { amount: "0", currency: "USDT" });
});

test("OKX 行情刷新对全部持仓按 USDT 计价，非 USDT 计价对不参与取值", async () => {
  const previous = snapshot({
    total: { amount: "999", currency: "USDT" },
    holdings: [
      okxPositionHolding({ asset: "SOL", quantity: "3", positionId: "sol-1" }),
      okxPositionHolding({ asset: "XYZ", quantity: "10", positionId: "xyz-1" }),
    ],
  });
  const next = await refreshOkxPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [
      okxInstrument("SOL"),
      okxInstrument("XYZ"),
      okxUsdtUsdInstrument(),
    ],
    tickers: [
      okxTicker("SOL-USDT", "150", observedNow(-30_000)),
      okxTicker("XYZ-USDT", "2", observedNow(-30_000)),
    ],
  });
  for (const item of next.holdings) {
    assert.equal(item.currency, "USDT");
    assert.deepEqual(item.currentPrice?.currency, "USDT");
    assert.deepEqual(item.sourceMarketValue?.currency, "USDT");
  }
  assert.deepEqual(next.holdings.map((item) => item.symbol), ["SOL", "XYZ"]);
  assert.deepEqual(next.total, { amount: "999", currency: "USDT" });
  assert.deepEqual(next.exchangeRates[0], {
    baseCurrency: "USDT",
    quoteCurrency: "USD",
    rate: "1",
    source: "USDT/USD 固定兜底（1:1）",
    observedAt: next.exchangeRates[0]?.observedAt,
  });
});

test("OKX 保留较新价格时只更新持仓市值并保留来源总额", async () => {
  const olderPricedAt = observedNow(-120_000);
  const newerPricedAt = observedNow(-30_000);
  const previous = snapshot({
    total: { amount: "36000", currency: "USDT" },
    holdings: [
      holding({
        symbol: "BTC",
        sourceAsset: "BTC",
        sourceAccount: "spot",
        providerPositionId: "btc-1",
        quantity: "0.5",
        currentPrice: { amount: "70000", currency: "USDT" },
        marketValue: "35000",
        sourceMarketValue: { amount: "35000", currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "OKX 现货 BTC-USDT",
          pricedAt: newerPricedAt,
        },
      }),
    ],
  });
  const next = await refreshOkxPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [okxInstrument("BTC"), okxUsdtUsdInstrument()],
    tickers: [okxTicker("BTC-USDT", "60000", olderPricedAt)],
  });
  const [btc] = next.holdings;
  assert.deepEqual(btc.currentPrice, { amount: "70000", currency: "USDT" });
  assert.equal(btc.marketValue, "35000");
  assert.deepEqual(btc.sourceMarketValue, { amount: "35000", currency: "USDT" });
  assert.deepEqual(btc.valuation, {
    status: "valued",
    priceSource: "OKX 现货 BTC-USDT",
    pricedAt: newerPricedAt,
  });
  assert.deepEqual(next.total, { amount: "36000", currency: "USDT" });
});

test("OKX 旧快照缺少来源资产分区时行情刷新失败并说明原因", async () => {
  const refresher = okxRefresher(noReferencePrices(), okxFetch({ observedAt: observedNow() }));
  await assert.rejects(
    refresher.refresh({
      source: source({
        kind: "okx",
        snapshot: snapshot({ holdings: [holding({ symbol: "BTC" })] }),
      }),
      credentials: okxOkxCredentials(),
      mode: "prices",
      attemptedAt: observedNow(),
      signal: new AbortController().signal,
      persistCredentials: async () => undefined,
    }),
    /OKX 旧快照缺少来源资产分区/,
  );
});

test("OKX 刷新器拒绝非 OKX 来源", async () => {
  const refresher = okxRefresher(noReferencePrices(), async () => {
    throw new Error("不应发起 HTTP 请求");
  });
  await assert.rejects(
    refresher.refresh({
      source: source({
        kind: "bitget",
        snapshot: snapshot({ holdings: [] }),
      }),
      credentials: okxOkxCredentials(),
      mode: "prices",
      attemptedAt: observedNow(),
      signal: new AbortController().signal,
      persistCredentials: async () => undefined,
    }),
    /OKX 刷新器不支持来源类型：bitget/,
  );
});

// ---------- Bitget ----------

function bitgetFetch(input: {
  instruments?: unknown[];
  tickers?: unknown[];
}): (request: string | URL | Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.toString()).pathname;
    if (path === "/api/v2/spot/public/symbols") {
      return bitgetResponse(input.instruments ?? []);
    }
    if (path === "/api/v2/spot/market/tickers") {
      return bitgetResponse(input.tickers ?? []);
    }
    throw new Error(`意外 Bitget 请求：${path}`);
  };
}

function bitgetCredentials(): string {
  return JSON.stringify({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    passphrase: PASSPHRASE,
    accountMode: "classic",
  });
}

function bitgetInstrument(asset: string): unknown {
  return {
    symbol: `${asset}USDT`,
    status: "online",
    baseCoin: asset,
    quoteCoin: "USDT",
  };
}

function bitgetUsdtUsdInstrument(): unknown {
  return {
    symbol: "USDTUSD",
    status: "online",
    baseCoin: "USDT",
    quoteCoin: "USD",
  };
}

function bitgetTicker(symbol: string, price: string, quotedAt: string): unknown {
  return { symbol, lastPr: price, ts: String(Date.parse(quotedAt)) };
}

const FAST_BITGET_RUNTIME = {
  now: () => Date.now(),
  sleep: async () => undefined,
  earnRequestIntervalMs: 0,
  retryDelaysMs: [] as readonly number[],
};

function bitgetRefresher(
  prices: Prices,
  request: ReturnType<typeof bitgetFetch>,
) {
  return new ProductionBitgetSourceRefresher(prices, request as never, FAST_BITGET_RUNTIME);
}

function bitgetPositionHolding(input: {
  asset: string;
  quantity: string;
  positionId: string;
}): AssetHolding {
  return holding({
    symbol: input.asset,
    sourceAsset: input.asset,
    sourceAccount: "spot",
    sourceProduct: "spot",
    providerPositionId: input.positionId,
    quantity: input.quantity,
  });
}

async function refreshBitgetPrices(input: {
  prices: Prices;
  previous: AssetSnapshot;
  instruments: unknown[];
  tickers: unknown[];
}): Promise<AssetSnapshot> {
  const observedAt = observedNow();
  const refresher = bitgetRefresher(input.prices, bitgetFetch({
    instruments: input.instruments,
    tickers: input.tickers,
  }));
  const result = await refresher.refresh({
    source: source({ kind: "bitget", snapshot: input.previous }),
    credentials: bitgetCredentials(),
    mode: "prices",
    attemptedAt: observedAt,
    signal: new AbortController().signal,
    persistCredentials: async () => undefined,
  });
  return result.snapshot;
}

test("Bitget 行情刷新缺少报价时不低估持仓，也不把来源总额归零", async () => {
  const previous = snapshot({
    total: { amount: "1234", currency: "USDT" },
    holdings: [
      bitgetPositionHolding({ asset: "BTC", quantity: "0.5", positionId: "btc-1" }),
    ],
  });
  const next = await refreshBitgetPrices({
    prices: usdtReferencePrices(observedNow()),
    previous,
    instruments: [bitgetInstrument("BTC"), bitgetUsdtUsdInstrument()],
    tickers: [],
  });
  const [btc] = next.holdings;
  assert.equal(btc.currentPrice, null);
  assert.equal(btc.marketValue, null);
  assert.equal(btc.sourceMarketValue, null);
  assert.deepEqual(btc.valuation, {
    status: "quote-unavailable",
    reason: "Bitget 平台总额已包含，但没有可靠的 BTC USDT 持仓行情",
  });
  assert.deepEqual(next.total, { amount: "1234", currency: "USDT" });
});

test("Bitget 行情刷新跳过过期与非数字的 ticker 时间戳", async () => {
  const previous = snapshot({
    total: { amount: "2222", currency: "USDT" },
    holdings: [
      bitgetPositionHolding({ asset: "ETH", quantity: "2", positionId: "eth-1" }),
    ],
  });
  const next = await refreshBitgetPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [bitgetInstrument("ETH"), bitgetUsdtUsdInstrument()],
    tickers: [
      bitgetTicker("ETHUSDT", "3000", observedNow(-6 * 60_000)),
      { symbol: "ETHUSDT", lastPr: "3100", ts: "not-a-number" },
    ],
  });
  const [eth] = next.holdings;
  assert.equal(eth.currentPrice, null);
  assert.deepEqual(eth.valuation, {
    status: "quote-unavailable",
    reason: "Bitget 平台总额已包含，但没有可靠的 ETH USDT 持仓行情",
  });
  assert.deepEqual(next.total, { amount: "2222", currency: "USDT" });
});

test("Bitget 按快照计价货币给出 USD 行情，并保持计价单位一致", async () => {
  const previous = snapshot({
    total: { amount: "32100", currency: "USD" },
    holdings: [
      holding({
        symbol: "BTC",
        sourceAsset: "BTC",
        sourceAccount: "spot",
        sourceProduct: "spot",
        providerPositionId: "btc-1",
        quantity: "0.5",
        currency: "USD",
      }),
    ],
  });
  const quotedAt = observedNow(-30_000);
  const next = await refreshBitgetPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [bitgetInstrument("BTC"), bitgetUsdtUsdInstrument()],
    tickers: [
      bitgetTicker("BTCUSDT", "60000", quotedAt),
      bitgetTicker("USDTUSD", "1", quotedAt),
    ],
  });
  const [btc] = next.holdings;
  assert.deepEqual(btc.currentPrice, { amount: "60000", currency: "USD" });
  assert.deepEqual(btc.sourceMarketValue, { amount: "30000", currency: "USD" });
  assert.deepEqual(next.total, { amount: "32100", currency: "USD" });
  assert.equal(btc.currency, "USD");
  assert.deepEqual(next.exchangeRates, []);
});

test("Bitget 保留较新价格时只更新持仓市值并保留来源总额", async () => {
  const olderPricedAt = observedNow(-120_000);
  const newerPricedAt = observedNow(-30_000);
  const previous = snapshot({
    total: { amount: "1900", currency: "USDT" },
    holdings: [
      holding({
        symbol: "SOL",
        sourceAsset: "SOL",
        sourceAccount: "spot",
        sourceProduct: "spot",
        providerPositionId: "sol-1",
        quantity: "10",
        currentPrice: { amount: "180", currency: "USDT" },
        marketValue: "1800",
        sourceMarketValue: { amount: "1800", currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "Bitget 现货 SOLUSDT",
          pricedAt: newerPricedAt,
        },
      }),
    ],
  });
  const next = await refreshBitgetPrices({
    prices: noReferencePrices(),
    previous,
    instruments: [bitgetInstrument("SOL"), bitgetUsdtUsdInstrument()],
    tickers: [bitgetTicker("SOLUSDT", "150", olderPricedAt)],
  });
  const [sol] = next.holdings;
  assert.deepEqual(sol.currentPrice, { amount: "180", currency: "USDT" });
  assert.equal(sol.marketValue, "1800");
  assert.deepEqual(sol.sourceMarketValue, { amount: "1800", currency: "USDT" });
  assert.deepEqual(next.total, { amount: "1900", currency: "USDT" });
});

test("Bitget 旧快照缺少来源资产分区时行情刷新失败并说明原因", async () => {
  const refresher = bitgetRefresher(noReferencePrices(), bitgetFetch({}));
  await assert.rejects(
    refresher.refresh({
      source: source({
        kind: "bitget",
        snapshot: snapshot({ holdings: [holding({ symbol: "BTC" })] }),
      }),
      credentials: bitgetCredentials(),
      mode: "prices",
      attemptedAt: observedNow(),
      signal: new AbortController().signal,
      persistCredentials: async () => undefined,
    }),
    /Bitget 旧快照缺少来源资产分区/,
  );
});

test("Bitget 刷新器拒绝非 Bitget 来源", async () => {
  const refresher = bitgetRefresher(
    noReferencePrices(),
    (async () => {
      throw new Error("不应发起 HTTP 请求");
    }) as never,
  );
  await assert.rejects(
    refresher.refresh({
      source: source({ kind: "okx", snapshot: snapshot({ holdings: [] }) }),
      credentials: bitgetCredentials(),
      mode: "prices",
      attemptedAt: observedNow(),
      signal: new AbortController().signal,
      persistCredentials: async () => undefined,
    }),
    /Bitget 刷新器不支持来源类型：okx/,
  );
});
