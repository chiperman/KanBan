import assert from "node:assert/strict";
import test from "node:test";

import { formatAssetUnitPrice } from "@/ui/asset-price-display";

test("加密资产单价保留来源精度", () => {
  assert.equal(
    formatAssetUnitPrice("0.00000309", "crypto"),
    "0.00000309",
  );
  assert.equal(
    formatAssetUnitPrice("12345.678901", "crypto"),
    "12,345.678901",
  );
});

test("证券与现金单价固定显示两位小数", () => {
  assert.equal(
    formatAssetUnitPrice("12345.678", "securities"),
    "12,345.68",
  );
  assert.equal(formatAssetUnitPrice("1", "cash"), "1.00");
});
