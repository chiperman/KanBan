import assert from "node:assert/strict";
import test from "node:test";

import { ProductionBinanceSourceRefresher } from "./binance";
import { ProductionOkxSourceRefresher } from "./okx";
import { ProductionBitgetSourceRefresher } from "./bitget";
import type { AssetSourceKind, AssetSourceSummary, Prices } from "@/server/ports";

const attemptedAt = "2026-10-13T08:00:00.000Z";
const credentials = {
  apiKey: "readonly-test-key",
  apiSecret: "readonly-test-secret",
  passphrase: "readonly-test-passphrase",
  accountMode: "classic",
};

function source(kind: AssetSourceKind): AssetSourceSummary {
  return {
    id: "credential-decoding-source", kind, label: "测试来源", accountId: "test-account",
    permissions: ["market-data", "account", "positions"], credentialReference: "test-reference",
    snapshot: { total: { amount: "100", currency: "USD" }, holdings: [], exchangeRates: [], syncedAt: attemptedAt },
    sync: { status: "current", lastSuccessfulAt: attemptedAt, lastAttemptAt: attemptedAt, error: null },
  };
}

for (const [provider, kind, Refresher] of [
  ["Binance", "binance", ProductionBinanceSourceRefresher],
  ["OKX", "okx", ProductionOkxSourceRefresher],
  ["Bitget", "bitget", ProductionBitgetSourceRefresher],
] as const) {
  test(`${provider} 刷新在网络读取前拒绝无效凭证，保留平台字段校验`, async () => {
    let networkReads = 0;
    let priceReads = 0;
    const prices: Prices = { async quote() { priceReads += 1; return null; } };
    const refresher = new Refresher(prices, async () => {
      networkReads += 1;
      throw new Error("unexpected-network-read");
    });
    const refresh = (value: string) => refresher.refresh({
      source: source(kind), credentials: value, mode: "all", attemptedAt,
      signal: new AbortController().signal,
      async persistCredentials() { assert.fail("只读校验不得写入凭证"); },
    });
    for (const value of ['{"apiSecret":"must-not-leak",', "null", "[]", '"must-not-leak"']) {
      await assert.rejects(refresh(value), new Error(`${provider} 只读凭证格式无效`));
    }
    await assert.rejects(
      refresh(JSON.stringify({ ...credentials, apiKey: "" })),
      new Error(`${provider} 响应缺少 apiKey`),
    );
    await assert.rejects(
      refresh(JSON.stringify({ ...credentials, apiSecret: null })),
      new Error(`${provider} 响应缺少 apiSecret`),
    );
    if (kind !== "binance") {
      await assert.rejects(
        refresh(JSON.stringify({ ...credentials, passphrase: "" })),
        new Error(`${provider} 响应缺少 passphrase`),
      );
    }
    if (kind === "okx") {
      await assert.rejects(refresh(JSON.stringify({ ...credentials, region: "invalid" })), new Error("OKX 注册区域无效"));
    }
    if (kind === "bitget") {
      for (const accountMode of [undefined, "invalid"]) {
        await assert.rejects(refresh(JSON.stringify({ ...credentials, accountMode })), new Error("Bitget 账户类型无效"));
      }
    }
    assert.equal(networkReads, 0);
    assert.equal(priceReads, 0);
  });

  test(`${provider} 有效凭证仍进入原平台读取路径`, async () => {
    const stop = new Error("offline-read-boundary");
    let networkReads = 0;
    const refresher = new Refresher({ async quote() { return null; } }, async (_input, init) => {
      networkReads += 1;
      assert.equal(init?.method, "GET");
      throw stop;
    });
    await assert.rejects(refresher.refresh({
      source: source(kind), credentials: JSON.stringify(credentials), mode: "all", attemptedAt,
      signal: new AbortController().signal,
      async persistCredentials() { assert.fail("只读读取不得写入凭证"); },
    }), (error: unknown) => error === stop);
    assert.equal(networkReads, 1);
  });
}
