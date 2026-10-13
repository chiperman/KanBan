import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonDecoder,
} from "@/server/asset-sources/json";

for (const provider of ["Binance", "OKX", "Bitget"]) {
  test(`${provider} 凭证解码保留字段原值，不改写平台专属字段`, () => {
    const decoder = createJsonDecoder(provider);
    const credentials = {
      apiKey: " readonly-key ",
      apiSecret: "readonly-secret",
      passphrase: "readonly-passphrase",
      region: "eea",
      accountMode: "uta",
    };
    assert.deepEqual(decoder.credentialRecord(JSON.stringify(credentials)), credentials);
    assert.deepEqual(decoder.credentialRecord("{}"), {});
  });

  test(`${provider} 凭证解码拒绝畸形 JSON 和非对象，不泄露输入`, () => {
    const decoder = createJsonDecoder(provider);
    for (const input of [
      '{"apiSecret":"must-not-leak",', "null", "[]", '"must-not-leak"', "1", "true",
    ]) {
      assert.throws(
        () => decoder.credentialRecord(input),
        new Error(`${provider} 只读凭证格式无效`),
      );
    }
  });

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
