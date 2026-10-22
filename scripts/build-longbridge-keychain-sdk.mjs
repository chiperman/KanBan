import { checkToolchain } from "./check-toolchain.mjs";
checkToolchain();
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { writeArtifactManifest } from "./native-artifact.mjs";

const rust = execFileSync("rustc", ["--version"], { encoding: "utf8" });
if (!["rustc 1.97.1 ", "rustc 1.99.0 "].some(version => rust.startsWith(version))) throw new Error("请使用 Rust 1.97.1 或 1.99.0 构建原生产物。");
const root = process.cwd();
const nativeRoot = path.join(root, "native", "longbridge-keychain-sdk");
const manifest = path.join(nativeRoot, "Cargo.toml");
const target = path.join(nativeRoot, "target", "release", "libkanban_longbridge_keychain_sdk.dylib");
const output = path.join(nativeRoot, "kanban_longbridge_keychain_sdk.node");

execFileSync("cargo", ["build", "--locked", "--release", "--manifest-path", manifest], {
  cwd: root,
  stdio: "inherit",
});
if (!existsSync(target)) {
  throw new Error(`未找到长桥 Keychain SDK 构建产物：${target}`);
}
mkdirSync(nativeRoot, { recursive: true });
copyFileSync(target, output);
execFileSync("codesign", ["--force", "--sign", "-", output], {
  cwd: root,
  stdio: "inherit",
});

writeArtifactManifest(root);
