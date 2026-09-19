import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { checkToolchain } from "./check-toolchain.mjs";

const outputName = "kanban_longbridge_keychain_sdk.node";
function hash(contents) { return createHash("sha256").update(contents).digest("hex"); }
export function sourceFingerprint(root) {
  const base = path.join(root, "native/longbridge-keychain-sdk");
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap((entry) => {
      if (["target", ".git"].includes(entry.name) || entry.name.endsWith(".node") || entry.name === "artifact.json") return [];
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : [path.relative(base, file), hash(readFileSync(file))];
    });
  }
  return hash(JSON.stringify(walk(base)));
}
export function writeArtifactManifest(root = process.cwd()) {
  const base = path.join(root, "native/longbridge-keychain-sdk");
  writeFileSync(path.join(base, "artifact.json"), JSON.stringify({
    format: 1, platform: process.platform, arch: process.arch, node: process.versions.node,
    napi: 8, source: sourceFingerprint(root), binary: hash(readFileSync(path.join(base, outputName))),
  }, null, 2) + "\n");
}
export function checkNativeArtifact(root = process.cwd(), { load = true } = {}) {
  checkToolchain();
  const base = path.join(root, "native/longbridge-keychain-sdk");
  try {
    const value = JSON.parse(readFileSync(path.join(base, "artifact.json"), "utf8"));
    if (value.format !== 1 || value.platform !== process.platform || value.arch !== process.arch ||
        value.node !== process.versions.node || value.napi !== 8 || Number(process.versions.napi) < value.napi ||
        value.source !== sourceFingerprint(root) || value.binary !== hash(readFileSync(path.join(base, outputName)))) throw new Error("不匹配");
    if (load) {
      const sdk = createRequire(import.meta.url)(path.join(base, outputName));
      for (const key of ["beginAuthorization", "authorizationStatus", "forgetAuthorization", "readAssets"]) {
        if (typeof sdk[key] !== "function") throw new Error("接口不匹配");
      }
    }
  } catch {
    throw new Error("长桥原生产物缺失、过期或不兼容；请运行 pnpm native:longbridge:build 后重试。");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkNativeArtifact();
