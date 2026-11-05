import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir, tmpdir } from "node:os";

const source = realpathSync(process.cwd());
const args = process.argv.slice(2);
const directory = args.shift();
if (!directory || directory.startsWith("--")) throw new Error("用法：pnpm runtime:prepare <新永久目录> [--data-dir <绝对路径>] [--env-file <路径>] [--port 3001] [--origin <HTTPS入口>]");
const options = {};
while (args.length) {
  const key = args.shift();
  if (!["--data-dir", "--env-file", "--port", "--origin"].includes(key) || !args.length) throw new Error("运行副本参数无效");
  options[key] = args.shift();
}
const destination = path.resolve(directory);
if (options["--data-dir"] && !path.isAbsolute(options["--data-dir"])) throw new Error("--data-dir 必须使用绝对路径");
const dataDir = path.resolve(options["--data-dir"] || path.join(homedir(), "Library/Application Support/KanBan/data"));
const port = Number(options["--port"] || 3001);
const origin = options["--origin"] || `http://localhost:${port}`;
const url = new URL(origin);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || url.origin !== origin ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) throw new Error("端口或登录入口无效；远程入口必须使用 HTTPS");
if (existsSync(destination) || destination.startsWith(source + path.sep) || destination.includes("/.codex/worktrees/")) throw new Error("必须选择源码目录之外尚不存在的永久目录；不会覆盖已有运行副本");
if (dataDir === path.join(source, "data") || dataDir.startsWith(source + path.sep) || dataDir === destination || dataDir.startsWith(destination + path.sep)) throw new Error("正式数据必须在开发目录和运行副本之外独立保存");
const envFile = path.resolve(options["--env-file"] || path.join(source, ".env.local"));
if (!existsSync(envFile)) throw new Error("请用 --env-file 指定包含服务端加密密钥和来源配置的环境文件");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("请通过 pnpm runtime:prepare 调用");
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: source }).toString().split("\0").filter(Boolean);
mkdirSync(destination, { recursive: true, mode: 0o700 });
for (const relative of new Set(files)) {
  const original = path.join(source, relative);
  if (!existsSync(original) || !statSync(original).isFile()) continue;
  const output = path.join(destination, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(original, output);
}
copyFileSync(envFile, path.join(destination, ".env.local"));
chmodSync(path.join(destination, ".env.local"), 0o600);
const executablePath = [...new Set([path.dirname(process.execPath), ...(process.env.PATH || "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(path.delimiter);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: source, encoding: "utf8" }).trim().length > 0;
const sourceInfo = {
  commit, dirty, preparedAt: new Date().toISOString(),
  ...(!dirty && process.env.KANBAN_DEPLOY_COMMIT === commit &&
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(process.env.KANBAN_DEPLOY_CI_URL || "")
    ? { mainBuildUrl: process.env.KANBAN_DEPLOY_CI_URL } : {}),
};
writeFileSync(path.join(destination, ".kanban-runtime.json"), JSON.stringify({ dataDir, port, origin, executablePath, sourceInfo }, null, 2) + "\n", { mode: 0o600 });
// 构建期间即使页面初始化服务，也只能接触一次性的空库，不能迁移或写入正式库。
const buildData = mkdtempSync(path.join(tmpdir(), "kanban-build-"));
const environment = { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: ".next", KANBAN_DATA_DIR: buildData, PAD_PUBLIC_ORIGIN: origin };
// 独立安装依赖、构建；生产副本不引用临时 worktree 的 node_modules 或构建目录。
try {
  execFileSync(process.execPath, [pnpmCli, "install", "--frozen-lockfile", "--prod=false"], { cwd: destination, env: environment, stdio: "inherit" });
  execFileSync(process.execPath, [pnpmCli, "exec", "next", "build"], { cwd: destination, env: environment, stdio: "inherit" });
} finally {
  rmSync(buildData, { recursive: true, force: true });
}
process.stdout.write(`运行副本已准备：${destination}\n正式数据：${dataDir}\n进入该目录运行 pnpm background:launchd install 可启用；本命令尚未安装后台任务。\n`);
