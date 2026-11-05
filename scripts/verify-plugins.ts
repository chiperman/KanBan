import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundledPluginPackages } from "@/server/asset-source-plugins/registry";
import { invokePlugin } from "@/server/asset-source-plugins/stdio-host";
import { OFFICIAL_PLUGIN_IDS } from "@/server/asset-source-plugins/official";
import officialCatalog from "../plugins/official.json" with { type: "json" };

const workspace = path.resolve(process.cwd());
const temporary = mkdtempSync(path.join(tmpdir(), "kanban-official-integrations-"));
const output = path.join(temporary, "packages");

try {
  const catalogIds = officialCatalog.plugins.map(plugin => plugin.id);
  const officialIds = new Set<string>(OFFICIAL_PLUGIN_IDS);
  if (new Set(catalogIds).size !== catalogIds.length ||
      catalogIds.length !== OFFICIAL_PLUGIN_IDS.length ||
      catalogIds.some(id => !officialIds.has(id))) {
    throw new Error("官方集成运行白名单与展示清单不一致");
  }

  execFileSync(process.execPath, [
    path.join(workspace, "scripts/build-source-plugins.mjs"),
    output,
  ], { cwd: workspace, stdio: "inherit" });

  const packages = bundledPluginPackages(output);
  const ids = new Set(packages.map(pkg => pkg.manifest.id));
  if (packages.length !== OFFICIAL_PLUGIN_IDS.length || OFFICIAL_PLUGIN_IDS.some(id => !ids.has(id))) {
    throw new Error("官方集成构建产物与官方清单不一致");
  }

  for (const pkg of packages) {
    const listed = officialCatalog.plugins.find(plugin => plugin.id === pkg.manifest.id);
    if (!listed || pkg.manifest.capabilities.includes("assets.read") !== listed.assetSource ||
        pkg.manifest.metadata?.summary !== listed.summary || pkg.manifest.metadata?.publisher !== listed.publisher ||
        pkg.manifest.metadata?.homepage !== listed.homepage ||
        (listed.assetSource && pkg.manifest.description?.label !== listed.label)) {
      throw new Error(`官方集成清单与展示元数据不一致：${pkg.manifest.id}`);
    }
    const initialized = await invokePlugin(pkg, "initialize", {}, {
      signal: AbortSignal.timeout(5000),
      persistCredentials: async () => { throw new Error("验证阶段不能保存凭证"); },
    }, undefined, 5000);
    if (JSON.stringify(initialized) !== JSON.stringify(pkg.manifest)) {
      throw new Error(`官方集成握手清单不一致：${pkg.manifest.id}`);
    }
    console.log(`官方集成构建与握手通过：${pkg.manifest.id} v${pkg.manifest.version}`);
  }
  console.log(`官方集成验证通过：${packages.length} 个集成；未读取正式数据或网络账户。`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
