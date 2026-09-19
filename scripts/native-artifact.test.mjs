import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkNativeArtifact, writeArtifactManifest } from "./native-artifact.mjs";

test("原生产物缺失、代码变化和二进制损坏均要求显式重建", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kanban-native-fixture-"));
  const base = path.join(root, "native/longbridge-keychain-sdk");
  mkdirSync(base, { recursive: true });
  try {
    assert.throws(() => checkNativeArtifact(root, {load:false}), /native:longbridge:build/);
    writeFileSync(path.join(base, "Cargo.toml"), "version=1");
    writeFileSync(path.join(base, "kanban_longbridge_keychain_sdk.node"), "fake-binary");
    writeArtifactManifest(root);
    checkNativeArtifact(root, {load:false});
    writeFileSync(path.join(base, "Cargo.toml"), "version=2");
    assert.throws(() => checkNativeArtifact(root, {load:false}), /过期/);
    writeArtifactManifest(root);
    writeFileSync(path.join(base, "kanban_longbridge_keychain_sdk.node"), "corrupt");
    assert.throws(() => checkNativeArtifact(root, {load:false}), /不兼容/);
    writeArtifactManifest(root);
    const manifest = JSON.parse(readFileSync(path.join(base, "artifact.json"), "utf8"));
    manifest.arch = "wrong";
    writeFileSync(path.join(base, "artifact.json"), JSON.stringify(manifest));
    assert.throws(() => checkNativeArtifact(root, {load:false}), /不兼容/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("开发和生产启动不再执行 Cargo", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts.prestart, "pnpm native:longbridge:check");
  assert.equal(pkg.scripts.predev, "pnpm native:longbridge:check");
});
