import ts from "typescript";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Emit the complete runtime import graph. Installed packages need only Node, never this checkout or node_modules.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.argv[2] || path.join(workspace, "plugins/binance"));
const destination = path.resolve(process.argv[3] || path.join(workspace, "dist/plugins/binance"));
if (existsSync(destination)) throw new Error("输出目录已存在，请指定新的目录");
const withSdk = process.argv.slice(4).includes("--with-sdk");
if (process.argv.slice(4).some(a => a !== "--with-sdk")) throw new Error("未知构建参数");
if (withSdk) {
  if (path.basename(source) !== "longbridge") throw new Error("--with-sdk 仅适用于长桥插件");
  const { checkNativeArtifact } = await import("../plugins/longbridge/native-artifact.mjs");
  checkNativeArtifact(workspace);
}
const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
mkdirSync(destination, { recursive: true });
writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const visited = new Set();
function emit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  if (!file.startsWith(workspace + path.sep)) throw new Error("构建依赖越出项目目录");
  if (file.startsWith(path.join(workspace, "src", "server") + path.sep)) {
    throw new Error(`插件运行时不得依赖核心服务：${path.relative(workspace, file)}`);
  }
  const target = path.join(destination, path.relative(workspace, file)).replace(/\.ts$/, ".mjs");
  mkdirSync(path.dirname(target), { recursive: true });
  if (file.endsWith(".json")) { copyFileSync(file, target); return; }
  let output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  output = output.replace(/(from\s+|import\s*)(["'])([^"']+)\2/g, (match, prefix, quote, specifier) => {
    if (specifier.startsWith("node:")) return match;
    if (!(specifier.startsWith("@/") || specifier.startsWith("."))) throw new Error(`插件存在未打包依赖：${specifier}`);
    let dependency = specifier.startsWith("@/") ? path.join(workspace, "src", specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    if (!path.extname(dependency)) dependency += ".ts";
    emit(dependency);
    let relative = path.relative(path.dirname(file), dependency).replace(/\.ts$/, ".mjs").split(path.sep).join("/");
    if (!relative.startsWith(".")) relative = "./" + relative;
    return `${prefix}${quote}${relative}${quote}${dependency.endsWith(".json") ? ' with { type: "json" }' : ""}`;
  });
  writeFileSync(target, output);
}
emit(path.join(workspace, manifest.entry.replace(/\.mjs$/, ".ts")));
if (manifest.id === "longbridge") {
  // Native loading is dynamic. Include its loader and source fingerprint inputs explicitly.
  emit(path.join(workspace, "plugins/longbridge/native-artifact.mjs"));
  cpSync(path.join(workspace, "plugins/longbridge/native"), path.join(destination, "plugins/longbridge/native"), {
    recursive: true, filter: file => !file.split(path.sep).includes("target") &&
      (withSdk || (!file.endsWith(".node") && !file.endsWith("artifact.json"))),
  });
}
console.log(`插件已构建：${destination}（${visited.size} 个独立文件）`);
