import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const label = "com.xiaox.kanban.formal-daily-settlement";
const workspace = process.cwd();
const launchAgents = path.join(homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgents, `${label}.plist`);
const dataDir = path.join(workspace, "data");

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plist() {
  const argumentsList = [
    process.execPath,
    "--experimental-transform-types",
    "--import",
    path.join(workspace, "scripts", "register-ts-alias.mjs"),
    path.join(workspace, "scripts", "run-formal-daily-settlement.ts"),
  ]
    .map((value) => `      <string>${xml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsList}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(workspace)}</string>
    <key>StartInterval</key>
    <integer>900</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xml(path.join(dataDir, "formal-daily-settlement.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(dataDir, "formal-daily-settlement.error.log"))}</string>
  </dict>
</plist>
`;
}

function target() {
  return `gui/${process.getuid()}/${label}`;
}

function launchctl(argumentsList) {
  execFileSync("launchctl", argumentsList, {
    stdio: "inherit",
  });
}

function install() {
  mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (existsSync(plistPath)) {
    try {
      launchctl(["bootout", target()]);
    } catch {
      // 已停止或旧 plist 尚未加载时继续更新本服务定义。
    }
  }
  writeFileSync(plistPath, plist(), { mode: 0o600 });
  chmodSync(plistPath, 0o600);
  launchctl(["bootstrap", `gui/${process.getuid()}`, plistPath]);
  process.stdout.write(`已安装并加载 ${label}\n`);
}

function status() {
  if (!existsSync(plistPath)) {
    process.stdout.write(`未安装 ${label}\n`);
    return;
  }
  process.stdout.write(`${plistPath}\n`);
  launchctl(["print", target()]);
}

function remove() {
  if (existsSync(plistPath)) {
    try {
      launchctl(["bootout", target()]);
    } catch {
      // 允许移除未加载或已退出的同名服务。
    }
    unlinkSync(plistPath);
  }
  process.stdout.write(`已移除 ${label}\n`);
}

const action = process.argv[2];
if (action === "install") {
  install();
} else if (action === "status") {
  status();
} else if (action === "remove") {
  remove();
} else if (action === "print") {
  process.stdout.write(plist());
} else {
  process.stderr.write("用法：pnpm daily-settlement:launchd <install|status|remove|print>\n");
  process.exitCode = 1;
}
