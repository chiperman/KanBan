import assert from "node:assert/strict";
import test from "node:test";

import {
  assetSourceKindMetadata,
  isAssetSourceKind,
  isEvmWatchSourceKind,
} from "./asset-source-kinds";

test("来源类型注册表集中声明展示和能力元数据", () => {
  assert.deepEqual(assetSourceKindMetadata("longbridge"), {
    code: "LB",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: false,
    supportsSmallHoldingFilter: false,
    title: "长桥资产",
  });
  assert.equal(assetSourceKindMetadata("fixture"), null);
  assert.equal(isAssetSourceKind("manual"), true);
  assert.equal(isAssetSourceKind("fixture"), false);
  assert.equal(isEvmWatchSourceKind("evm-watch-bsc"), true);
  assert.equal(isEvmWatchSourceKind("binance"), false);
});

test("八种受支持来源保留名称、标识和能力，不改变既有展示与分支", () => {
  const cases = [
    ["longbridge", "LB", "长桥资产", false, false, false],
    ["binance", "BN", "Binance 资产", false, false, true],
    ["okx", "OKX", "OKX 资产", false, false, true],
    ["bitget", "BG", "Bitget 资产", false, false, true],
    ["bit", "BIT", "BIT / Matrixport 资产", false, false, true],
    ["evm-watch-ethereum", "ETH", "Ethereum 观察钱包", false, true, true],
    ["evm-watch-bsc", "BSC", "BNB Smart Chain 观察钱包", false, true, true],
    ["manual", "MANUAL", "手工资产记录", true, false, false],
  ] as const;
  for (const [kind, code, title, isManual, evm, products] of cases) {
    assert.equal(isAssetSourceKind(kind), true, kind);
    assert.equal(isEvmWatchSourceKind(kind), evm, kind);
    assert.deepEqual(assetSourceKindMetadata(kind), {
      code, title, isManual,
      supportsEvmTokenPreferences: evm,
      supportsProductCoverage: products,
      supportsSmallHoldingFilter: products,
    });
  }
});

test("来源类型校验拒绝未知值、原型属性及隐式字符串转换", () => {
  for (const kind of [
    "", "fixture", "Longbridge", "manual ", "evm-watch-solana",
    "__proto__", "constructor", "toString", null, undefined, 0, true,
    ["manual"], { toString: () => "manual" }, new String("manual"),
  ]) {
    assert.equal(isAssetSourceKind(kind), false);
    if (typeof kind === "string") assert.equal(assetSourceKindMetadata(kind), null);
  }
});
