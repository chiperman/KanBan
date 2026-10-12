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
