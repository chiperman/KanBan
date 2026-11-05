import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(process.argv[2] || "dist/plugins/packages");
if (existsSync(destination)) throw new Error("输出目录已存在，请指定新的目录");
for (const folder of readdirSync(path.join(workspace, "plugins")).sort()) {
 const source = path.join(workspace, "plugins", folder);
 if (!existsSync(path.join(source, "manifest.json"))) continue;
 execFileSync(process.execPath, [path.join(workspace, "scripts/build-source-plugin.mjs"), source, path.join(destination, folder),
   ...(folder === "longbridge" && process.argv.includes("--with-sdk") ? ["--with-sdk"] : []),
 ], { cwd: workspace, stdio: "inherit" });
}
