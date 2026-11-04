import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapLaunchAgent } from "./launchd-bootstrap.mjs";

if (process.platform !== "darwin") throw new Error("本地 CI 定时任务仅支持 macOS launchd");

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.KANBAN_CI_HOME || path.join(homedir(), "Library/Application Support/KanBan/ci");
const agents = path.join(homedir(), "Library/LaunchAgents");
const label = "com.xiaox.kanban.local-ci";
const plistFile = path.join(agents, `${label}.plist`);
const configFile = path.join(home, "config.json");
const action = process.argv[2];
const domain = `gui/${process.getuid()}`;

function repository() {
  return execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspace, encoding: "utf8" }).trim();
}

function readConfig() {
  if (!existsSync(configFile)) throw new Error(`缺少本地 CI 配置：${configFile}`);
  return JSON.parse(readFileSync(configFile, "utf8"));
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function plist() {
  const executablePath = [...new Set([path.dirname(process.execPath), ...(process.env.PATH || "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(path.delimiter);
  const log = path.join(home, "launchd.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(workspace, "scripts/local-ci.mjs"))}</string><string>run</string></array>
<key>WorkingDirectory</key><string>${xml(workspace)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(homedir())}</string><key>PATH</key><string>${xml(executablePath)}</string><key>KANBAN_CI_HOME</key><string>${xml(home)}</string></dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>300</integer>
<key>ProcessType</key><string>Background</string>
<key>ThrottleInterval</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

if (action === "install" || action === "print") {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(agents, { recursive: true, mode: 0o700 });
  if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify({
    repository: repository(),
    ref: "main",
    checkout: path.join(home, "checkout"),
    logs: path.join(home, "logs"),
    artifacts: path.join(home, "artifacts"),
    deployRuntime: false,
    publishPages: false,
    browserSmoke: false,
    keepRuns: 20,
  }, null, 2) + "\n", { mode: 0o600 });
  const output = plist();
  if (action === "print") process.stdout.write(output);
  else {
    try { execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" }); } catch { /* 初次安装时尚未加载。 */ }
    writeFileSync(plistFile, output, { mode: 0o600 });
    await bootstrapLaunchAgent(domain, plistFile);
    process.stdout.write(`已安装本地 CI：每 5 分钟检查 main\n配置：${configFile}\n`);
  }
} else if (action === "status") {
  try { execFileSync("/bin/launchctl", ["print", `${domain}/${label}`], { stdio: "inherit" }); } catch { process.stdout.write("本地 CI 未加载\n"); }
  if (existsSync(path.join(home, "state.json"))) process.stdout.write(readFileSync(path.join(home, "state.json"), "utf8"));
} else if (action === "remove") {
  try { execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" }); } catch { /* 已停止。 */ }
  if (existsSync(plistFile)) unlinkSync(plistFile);
  process.stdout.write("已移除本地 CI 定时任务；checkout、日志和产物保留。\n");
} else throw new Error("用法：pnpm ci:local:launchd <install|status|remove|print>");
