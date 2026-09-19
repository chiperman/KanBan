import assert from "node:assert/strict";
import test from "node:test";
import { checkToolchain } from "./check-toolchain.mjs";

test("工具链接受验证环境并在错误版本给出修复入口", () => {
  checkToolchain({ node: "24.15.0", userAgent: "pnpm/11.25.0 npm/? node/v24.15.0" });
  assert.throws(() => checkToolchain({ node: "22.0.0" }), /\.node-version/);
  assert.throws(() => checkToolchain({ node: "24.15.0", userAgent: "npm/11.0.0" }), /pnpm 11.25.0/);
});
