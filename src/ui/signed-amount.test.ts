import assert from "node:assert/strict";
import test from "node:test";
import { signedAmount, signedDisplayAmount } from "./signed-amount";

test("正值补加号，负值保持减号", () => {
  assert.equal(signedAmount("12.34"), "+12.34");
  assert.equal(signedAmount("-12.34"), "-12.34");
});

test("金额明细零值不加号，收益变化可保留正号", () => {
  assert.equal(signedAmount("0.00"), "0.00");
  assert.equal(signedAmount("0", undefined, { signZero: true }), "+0");
  assert.equal(signedAmount("-0.01", undefined, { signZero: true }), "-0.01");
});

test("已格式化金额按同一零值策略补号", () => {
  assert.equal(signedDisplayAmount("0", "0.00"), "0.00");
  assert.equal(signedDisplayAmount("0", "0.00", { signZero: true }), "+0.00");
  assert.equal(signedDisplayAmount("5", "5.00", { signZero: true }), "+5.00");
});

test("大额十进制字符串不经过 Number 转换", () => {
  assert.equal(signedAmount("9007199254740993.12"), "+9007199254740993.12");
});
