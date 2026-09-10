import assert from "node:assert/strict";
import test from "node:test";

import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";
import type {
  AssetSourceConnections,
  LongbridgeAuthorizationResult,
} from "@/server/ports";

const KEYCHAIN_RESULT: LongbridgeAuthorizationResult = {
  credentials: "macos-keychain:longbridge-reconnected-source",
  permissions: ["account", "positions"],
  account: { id: "same-account", label: "长桥测试账户" },
  snapshot: {
    total: { amount: "1", currency: "USD" },
    holdings: [],
    exchangeRates: [],
    syncedAt: "2026-08-28T00:00:00.000Z",
  },
};

test("长桥重新授权只替换当前来源，不替换同账户的其他来源", async () => {
  const calls: string[] = [];
  const connections: AssetSourceConnections = {
    async connectLongbridge() {
      calls.push("connectLongbridge");
    },
    async reconnectLongbridge(sourceId) {
      calls.push("reconnectLongbridge:" + sourceId);
    },
    async connectBinance() {},
    async connectOkx() {},
    async connectBitget() {},
    async connectBit() {},
    async connectEvm() {},
    async reconnectEvm() {},
  };

  const adapter = createAssetSourceProviderAdapters({
    longbridge: {} as never,
    binance: {} as never,
    okx: {} as never,
    bitget: {} as never,
    bit: {} as never,
    evm: {} as never,
    connections,
  }).find((item) => item.provider === "longbridge");
  assert.ok(adapter);

  await adapter.connect(
    { provider: "longbridge", ...KEYCHAIN_RESULT },
    "current-longbridge-source",
  );

  assert.deepEqual(calls, ["reconnectLongbridge:current-longbridge-source"]);
});
