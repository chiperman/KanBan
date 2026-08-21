import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonDecoder,
} from "@/server/asset-sources/json";

for (const provider of ["Binance", "OKX", "Bitget"]) {
  test(`${provider} JSON 解码保留结构与字段失败边界`, () => {
    const decoder = createJsonDecoder(provider);

    assert.deepEqual(decoder.record({ asset: "BTC" }), { asset: "BTC" });
    assert.deepEqual(decoder.list([{ asset: "BTC" }], `${provider} balances`), [{
      asset: "BTC",
    }]);
    assert.equal(decoder.text("BTC", "asset"), "BTC");
    assert.equal(decoder.nonNegativeDecimal("0.001", "balance"), "0.001");
    assert.equal(decoder.identifier(0, "id"), "0");

    assert.throws(
      () => decoder.record([], `${provider} root`),
      new Error(`${provider} root格式无效`),
    );
    assert.throws(
      () => decoder.list([null], `${provider} balances`),
      new Error(`${provider} balances格式无效`),
    );
    assert.throws(
      () => decoder.text("", "asset"),
      new Error(`${provider} 响应缺少 asset`),
    );
    assert.throws(
      () => decoder.nonNegativeDecimal("-0.001", "balance"),
      new Error(`${provider} 响应中的 balance 不是有效非负十进制数`),
    );
    assert.throws(
      () => decoder.identifier(-1, "id"),
      new Error(`${provider} 响应缺少 id`),
    );
  });
}
