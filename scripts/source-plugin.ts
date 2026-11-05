import path from "node:path";
import { PluginDistribution } from "@/server/asset-source-plugins/distribution";

try { process.loadEnvFile(path.join(process.cwd(), ".env.local")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

const [command] = process.argv.slice(2);
const root = path.resolve(process.env.KANBAN_BUNDLED_PLUGIN_DIR?.trim() || "dist/plugins/packages");
const service = new PluginDistribution(root);

if (command === "list" || command === "available") {
  for (const plugin of service.status().installed) {
    console.log(`${plugin.id} v${plugin.version} · ${plugin.label} · 官方内置`);
  }
  process.exit(0);
}

console.error("官方集成随 KanBan 应用提供，不支持安装、导入、更新、停用、卸载或自定义插件。");
console.error("如需开发自定义集成，请在自己的 KanBan 分支中实现并运行，不能写入正式数据目录。");
process.exitCode = 1;
