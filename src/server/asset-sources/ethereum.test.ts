import assert from "node:assert/strict";
import test from "node:test";

import { shouldExposeProtocolCoverage } from "@/server/asset-sources/ethereum";

test("协议覆盖仅在无余额且详细覆盖时隐藏", () => {
  const coverage = {
    product: "lista-slisbnb-withdrawal-request",
    capability: "detailed" as const,
    freshness: "current" as const,
    message: "未发现未领取申请",
  };
  const balance = {
    sourceAsset: "lista:withdrawal-request",
    contractAddress: null,
    symbol: "slisBNB",
    name: "slisBNB",
    quantity: "1",
  };
  for (const [balances, capability, expected] of [
    [[], "detailed", false],
    [[balance], "detailed", true],
    [[], "unknown", true],
  ] as const) {
    assert.equal(
      shouldExposeProtocolCoverage({
        balances,
        coverage: { ...coverage, capability },
      }),
      expected,
    );
  }
});
