import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { bootstrapLaunchAgent } from "./launchd-bootstrap.mjs";

const workspace = realpathSync(process.cwd());
const configPath = path.join(workspace, ".kanban-runtime.json");
const agents = path.join(homedir(), "Library/LaunchAgents");
const labels = ["com.xiaox.kanban.web", "com.xiaox.kanban.background-collection"];
const action = process.argv[2];
const target = label => `gui/${process.getuid()}/${label}`;
const file = label => path.join(agents, label + ".plist");
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
function config() {
  if (!existsSync(configPath)) throw new Error("请先运行 pnpm runtime:prepare <永久目录>，再到生成的目录安装后台任务");
  const result = JSON.parse(readFileSync(configPath, "utf8"));
  if (!path.isAbsolute(result.dataDir) || !Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) throw new Error("运行配置无效");
  if (workspace.includes("/.codex/worktrees/") || existsSync(path.join(workspace, ".git"))) throw new Error("后台任务必须使用独立的永久运行副本");
  if (!existsSync(path.join(workspace, ".next/BUILD_ID"))) throw new Error("缺少生产构建，请先完成 runtime:prepare");
  return result;
}
function plist(index, settings) {
  const args = index === 0 ? [process.execPath, path.join(workspace, "scripts/run-local-next.mjs"), "start", "--port", String(settings.port)] : [process.execPath, path.join(workspace, "scripts/run-background.mjs")];
  const environment = { PATH: settings.executablePath, NODE_ENV: "production", KANBAN_DATA_DIR: settings.dataDir, NEXT_DIST_DIR: ".next", PAD_PUBLIC_ORIGIN: settings.origin };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${labels[index]}</string>
<key>ProgramArguments</key><array>${args.map(value => `<string>${xml(value)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(workspace)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([key,value]) => `<key>${key}</key><string>${xml(value)}</string>`).join("")}</dict>
<key>RunAtLoad</key><true/>
${index === 0 ? "<key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>" : "<key>StartInterval</key><integer>60</integer>"}
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(settings.dataDir, index === 0 ? "web.log" : "background.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(settings.dataDir, index === 0 ? "web.error.log" : "background.error.log"))}</string>
</dict></plist>\n`;
}
function launchctl(args, quiet = false) {
  return execFileSync("/bin/launchctl", args, { stdio: quiet ? "ignore" : "inherit" });
}
if (process.platform !== "darwin") throw new Error("本机后台任务仅支持 macOS launchd");
if (action === "install" || action === "print") {
  const settings = config();
  if (action === "print") labels.forEach((_, index) => process.stdout.write(plist(index, settings)));
  else {
    mkdirSync(agents, { recursive: true, mode: 0o700 });
    mkdirSync(settings.dataDir, { recursive: true, mode: 0o700 });
    // 不覆盖其他运行副本已经安装的同名服务。
    for (const label of labels) {
      if (existsSync(file(label)) && !readFileSync(file(label), "utf8").includes(`<string>${xml(workspace)}</string>`)) throw new Error("已有其他运行副本的同名任务，请先在原副本移除");
    }
    for (const [index, label] of labels.entries()) {
      try { launchctl(["bootout", target(label)], true); } catch { /* 初次安装时尚未加载。 */ }
      writeFileSync(file(label), plist(index, settings), { mode: 0o600 });
      chmodSync(file(label), 0o600);
      await bootstrapLaunchAgent(`gui/${process.getuid()}`, file(label));
    }
    process.stdout.write(`已启用登录后后台运行：${settings.origin}\n`);
  }
} else if (action === "status") {
  for (const label of labels) {
    try { launchctl(["print", target(label)]); } catch { process.stdout.write(`${label} 未加载\n`); }
  }
} else if (action === "remove") {
  for (const label of labels) {
    if (!existsSync(file(label))) continue;
    if (!readFileSync(file(label), "utf8").includes(`<string>${xml(workspace)}</string>`)) throw new Error("任务属于其他运行副本，请在原副本移除");
    try { launchctl(["bootout", target(label)], true); } catch { /* 已停止时仍可移除。 */ }
    unlinkSync(file(label));
  }
  process.stdout.write("已移除本副本后台任务，数据保留。\n");
} else throw new Error("用法：pnpm background:launchd <install|status|remove|print>");
