import assert from "node:assert/strict";
import test from "node:test";

import { shouldExposeProtocolCoverage } from "@/server/asset-sources/ethereum";

test("没有 Lista 提现申请时不展示详细产品覆盖项", () => {
  assert.equal(
    shouldExposeProtocolCoverage({
      balances: [],
      coverage: {
        product: "lista-slisbnb-withdrawal-request",
        capability: "detailed",
        freshness: "current",
        message: "未发现未领取申请",
      },
    }),
    false,
  );
});

test("协议读取失败时保留产品覆盖诊断", () => {
  assert.equal(
    shouldExposeProtocolCoverage({
      balances: [],
      coverage: {
        product: "lista-slisbnb-withdrawal-request",
        capability: "unknown",
        freshness: "current",
        message: "RPC 超时",
      },
    }),
    true,
  );
});
