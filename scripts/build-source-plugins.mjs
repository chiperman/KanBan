import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(process.argv[2] || "dist/plugins/packages");
if (existsSync(destination)) throw new Error("输出目录已存在，请指定新的目录");
const catalog = JSON.parse(readFileSync(path.join(workspace, "plugins/official.json"), "utf8"));
const listedIds = catalog?.plugins?.map(plugin => plugin?.id);
if (!Array.isArray(listedIds) || new Set(listedIds).size !== listedIds.length || listedIds.some(id => typeof id !== "string" || !id)) {
 throw new Error("官方集成展示清单无效");
}
const officialIds = new Set(listedIds);
const builtIds = new Set();
for (const folder of readdirSync(path.join(workspace, "plugins")).sort()) {
 if (folder === "template") continue;
 const source = path.join(workspace, "plugins", folder);
 if (!existsSync(path.join(source, "manifest.json"))) continue;
 const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
 if (!officialIds.has(manifest?.id)) throw new Error(`未登记的官方集成：${folder}（${String(manifest?.id)}）`);
 if (builtIds.has(manifest.id)) throw new Error(`官方集成 ID 重复：${manifest.id}`);
 builtIds.add(manifest.id);
 execFileSync(process.execPath, [path.join(workspace, "scripts/build-source-plugin.mjs"), source, path.join(destination, folder),
   ...(folder === "longbridge" && process.argv.includes("--with-sdk") ? ["--with-sdk"] : []),
 ], { cwd: workspace, stdio: "inherit" });
}
const missing = listedIds.filter(id => !builtIds.has(id));
if (missing.length) throw new Error(`官方集成源码缺失：${missing.join(", ")}`);
