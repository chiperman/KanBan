import { pathToFileURL } from "node:url";

// This is the tested deployment contract, not the minimum claimed by Next.
export function checkToolchain({ node = process.versions.node, userAgent = process.env.npm_config_user_agent } = {}) {
  if (node !== "24.15.0") throw new Error("需要已验证的 Node 24.15.0；请按 .node-version 切换后重试。");
  if (userAgent && !userAgent.startsWith("pnpm/11.25.0 ")) throw new Error("需要 pnpm 11.25.0；请启用 packageManager 指定版本后重试。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkToolchain();
