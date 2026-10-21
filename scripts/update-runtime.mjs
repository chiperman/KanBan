import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { checkToolchain } from "./check-toolchain.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--check", "--help"].includes(args[0]))) {
  throw new Error("用法：pnpm runtime:update [--check|--help]");
}
if (args[0] === "--help") {
  console.log("pnpm runtime:update：将当前开发目录构建并更新到已安装的 3001 正式版。\n--check：只检查安装配置并显示更新目标，不构建或切换服务。");
  process.exit(0);
}
checkToolchain();
if (process.platform !== "darwin") throw new Error("正式版更新仅支持 macOS launchd");
const source = realpathSync(process.cwd());
if (!existsSync(path.join(source, ".git")) || existsSync(path.join(source, ".kanban-runtime.json"))) {
  throw new Error("请在开发仓库根目录执行更新命令");
}
const labels = ["com.xiaox.kanban.web", "com.xiaox.kanban.background-collection"];
const domain = `gui/${process.getuid()}`;
const files = labels.map(label => path.join(homedir(), "Library/LaunchAgents", `${label}.plist`));
const originals = files.map(file => readFileSync(file));
const installed = files.map(file => JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" })));
const previous = realpathSync(installed[0].WorkingDirectory);
if (installed[1].WorkingDirectory !== previous) throw new Error("网页和采集任务不属于同一运行副本，已停止更新");
const settings = JSON.parse(readFileSync(path.join(previous, ".kanban-runtime.json"), "utf8"));
if (!path.isAbsolute(settings.dataDir) || settings.port !== 3001 || !existsSync(path.join(settings.dataDir, "dashboard.sqlite"))) {
  throw new Error("未找到已安装的 3001 正式版或正式数据库，请先完成首次安装");
}
for (const job of installed) {
  if (job.EnvironmentVariables?.KANBAN_DATA_DIR !== settings.dataDir || job.EnvironmentVariables?.PAD_PUBLIC_ORIGIN !== settings.origin) {
    throw new Error("任务与运行配置的数据目录或登录入口不一致，已停止更新");
  }
}
const envFile = path.join(previous, ".env.local");
const envHash = () => createHash("sha256").update(readFileSync(envFile)).digest("hex");
const originalEnvHash = envHash();
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("请通过 pnpm runtime:update 调用");
function jobState(index) {
  const result = execFileSync("/bin/launchctl", ["list", labels[index]], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const exitStatus = /"LastExitStatus"\s*=\s*(-?\d+)/.exec(result);
  return { running: /"PID"\s*=\s*\d+/.test(result), failed: exitStatus !== null && Number(exitStatus[1]) !== 0 };
}
labels.forEach((_, index) => jobState(index));
console.log(`开发源码：${source}\n当前正式版：${previous}\n正式入口：${settings.origin}\n沿用数据：${settings.dataDir}`);
if (args[0] === "--check") process.exit(0);

const parent = path.dirname(previous);
const lock = path.join(parent, ".runtime-update.lock");
try { mkdirSync(lock, { mode: 0o700 }); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  throw new Error(`已有更新任务或上次更新未正常退出；请检查 ${lock} 内的 owner.json，确认进程退出后再移除此锁目录`);
}
const next = path.join(parent, `runtime-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
const pause = path.join(settings.dataDir, ".runtime-update-pause");
let child;
let interrupted = false;
let recovering = false;
let switched = false;
let paused = false;
let error;
writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, source, previous, next }) + "\n", { mode: 0o600 });
function assertActive() {
  if (interrupted && !recovering) throw new Error("更新已取消");
}
function onSignal() {
  interrupted = true;
  if (child && !recovering) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (failure) { if (failure.code !== "ESRCH") throw failure; }
  }
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
async function run(command, arguments_, cwd = source) {
  assertActive();
  await new Promise((resolve, reject) => {
    child = spawn(command, arguments_, { cwd, stdio: "inherit", detached: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`命令执行失败：${path.basename(command)}（${signal ?? code}）`)));
  }).finally(() => { child = undefined; });
}
async function waitForIdle() {
  const deadline = Date.now() + 6 * 60_000;
  while (jobState(1).running) {
    assertActive();
    if (Date.now() >= deadline) throw new Error("当前采集六分钟内尚未退出，保留旧版；稍后重试更新");
    await delay(1000);
  }
}
async function readCollectionState() {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path.join(settings.dataDir, "dashboard.sqlite"), { readOnly: true });
  try {
    const row = database.prepare("SELECT value FROM schema_metadata WHERE key = 'background_collection_state'").get();
    return row ? JSON.parse(row.value) : null;
  } finally { database.close(); }
}
async function healthy(runtime) {
  const buildId = readFileSync(path.join(runtime, ".next/BUILD_ID"), "utf8").trim();
  const manifest = `/_next/static/${encodeURIComponent(buildId)}/_buildManifest.js`;
  const expected = readFileSync(path.join(runtime, ".next/static", buildId, "_buildManifest.js"), "utf8");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assertActive();
    try {
      const url = `http://localhost:${settings.port}`;
      const response = await fetch(url + manifest, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      const matches = response.status === 200 && await response.text() === expected;
      const page = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
      if (matches && page.status === 200 && (await page.text()).includes("</html>")) return;
    } catch { /* 服务仍在启动。 */ }
    await delay(1000);
  }
  throw new Error("正式网页启动或版本检查失败");
}
async function unload(index) {
  await run("/bin/launchctl", ["bootout", `${domain}/${labels[index]}`]);
}
async function load(index) {
  await run("/bin/launchctl", ["bootstrap", domain, files[index]]);
}
try {
  console.log("1/4 构建独立新版，旧版网页和后台继续运行…");
  await run(process.execPath, [path.join(source, "scripts/prepare-runtime.mjs"), next, "--data-dir", settings.dataDir, "--env-file", envFile, "--port", String(settings.port), "--origin", settings.origin]);
  if (envHash() !== originalEnvHash || createHash("sha256").update(readFileSync(path.join(next, ".env.local"))).digest("hex") !== originalEnvHash) {
    throw new Error("构建期间正式环境配置发生变化，保留旧版，请重新更新");
  }
  for (let index = 0; index < files.length; index++) {
    if (!readFileSync(files[index]).equals(originals[index])) throw new Error("构建期间任务配置发生变化，保留旧版");
  }
  assertActive();
  console.log("2/4 等待当前采集完成，保留数据库、凭证和小时计划…");
  writeFileSync(pause, JSON.stringify({ pid: process.pid }) + "\n", { mode: 0o600, flag: "wx" });
  paused = true;
  await waitForIdle();
  switched = true;
  await unload(1);
  await unload(0);
  // 使用 SQLite 在线备份接口，不能直接复制主文件而遗漏 WAL。
  const { DatabaseSync, backup } = await import("node:sqlite");
  const rollbackDir = path.join(next, ".runtime-rollback");
  mkdirSync(rollbackDir, { mode: 0o700 });
  originals.forEach((bytes, index) => writeFileSync(path.join(rollbackDir, `${labels[index]}.plist`), bytes, { mode: 0o600 }));
  const database = new DatabaseSync(path.join(settings.dataDir, "dashboard.sqlite"), { readOnly: true });
  try { await backup(database, path.join(rollbackDir, "dashboard.sqlite")); }
  finally { database.close(); }
  chmodSync(path.join(rollbackDir, "dashboard.sqlite"), 0o600);
  console.log("3/4 安装新版任务并检查 3001…");
  // 复用安装入口生成任务；切换失败时恢复原任务文件。
  files.forEach(file => rmSync(file));
  await run(process.execPath, [path.join(next, "scripts/background-launchd.mjs"), "install"], next);
  await healthy(next);
  await waitForIdle();
  const beforeCheck = (await readCollectionState())?.checkedAt;
  rmSync(pause);
  paused = false;
  console.log("4/4 恢复后台检查并确认任务已加载…");
  await run("/bin/launchctl", ["kickstart", "-p", `${domain}/${labels[1]}`]);
  await waitForIdle();
  if (jobState(1).failed) throw new Error("新版后台检查失败");
  const afterCheck = await readCollectionState();
  if (!afterCheck?.completedAt || afterCheck.checkedAt === beforeCheck || afterCheck.error) throw new Error("新版后台未完成一次有效检查");
  if (!jobState(0).running) throw new Error("新版网页任务未运行");
  assertActive();
  console.log(`正式版已更新：${settings.origin}\n运行副本：${next}\n旧版保留：${previous}\n正式数据及采集周期沿用。`);
} catch (failure) {
  error = failure;
  if (switched) {
    recovering = true;
    console.error("更新未完成，正在恢复旧版任务…");
    try {
      // 若新版后台正在运行，仍等待它结束，避免中断已经开始的采集。
      let backgroundLoaded = false;
      try { jobState(1); backgroundLoaded = true; } catch { /* 后台可能尚未加载。 */ }
      if (backgroundLoaded) await waitForIdle();
      for (const index of [1, 0]) {
        try { jobState(index); } catch { continue; }
        await unload(index);
      }
      originals.forEach((bytes, index) => { writeFileSync(files[index], bytes, { mode: 0o600 }); chmodSync(files[index], 0o600); });
      if (paused) { rmSync(pause); paused = false; }
      await load(1);
      await load(0);
      await healthy(previous);
      console.error(`已恢复旧版：${settings.origin}；正式数据未被替换。`);
    } catch (recoveryError) {
      console.error(`自动恢复失败：${recoveryError.message}\n旧版副本：${previous}\n原任务与切换前数据库备份：${path.join(next, ".runtime-rollback")}`);
    }
  } else console.error("更新未切换，旧版继续运行。");
} finally {
  if (paused) rmSync(pause, { force: true });
  rmSync(lock, { recursive: true, force: true });
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
if (error) {
  console.error(error.message);
  process.exitCode = 1;
}
