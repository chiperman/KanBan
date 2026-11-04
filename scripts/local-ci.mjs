import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const home = process.env.KANBAN_CI_HOME || path.join(homedir(), "Library/Application Support/KanBan/ci");
const configFile = process.env.KANBAN_CI_CONFIG || path.join(home, "config.json");
const lockDirectory = path.join(home, "run.lock");
const defaults = {
  repository: "git@github.com:chiperman/KanBan.git",
  ref: "main",
  checkout: path.join(home, "checkout"),
  logs: path.join(home, "logs"),
  artifacts: path.join(home, "artifacts"),
  deployRuntime: false,
  publishPages: false,
  browserSmoke: false,
  keepRuns: 20,
};

function parseArgs(argv) {
  const [command = "run", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--browser-smoke") options.browserSmoke = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--skip-build") options.skipBuild = true;
    else if (argument.startsWith("--")) {
      options[argument.slice(2).replaceAll("-", "_")] = rest[++index];
    } else if (!options.argument) options.argument = argument;
    else throw new Error(`未知参数：${argument}`);
  }
  return { command, options };
}

function readConfig() {
  if (!existsSync(configFile)) throw new Error(`缺少本地 CI 配置：${configFile}\n先运行：pnpm ci:local:launchd install`);
  const config = { ...defaults, ...JSON.parse(readFileSync(configFile, "utf8")) };
  for (const key of ["checkout", "logs", "artifacts"]) config[key] = path.resolve(config[key]);
  if (!config.repository || !config.ref) throw new Error("本地 CI 配置缺少 repository 或 ref");
  if ((config.deployRuntime || config.publishPages) && config.ref !== "main") throw new Error("deployRuntime 和 publishPages 只允许绑定 main");
  return config;
}

function mkdir(directory) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }

function git(cwd, args, quiet = false) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"] }).trim();
}

function command(cwd, executable, args, environment, logFile, quiet = true) {
  appendFileSync(logFile, `$ ${executable} ${args.map((value) => JSON.stringify(value)).join(" ")}\n`);
  const result = spawnSync(executable, args, { cwd, env: environment, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
  if (quiet && result.stdout) appendFileSync(logFile, result.stdout);
  if (quiet && result.stderr) appendFileSync(logFile, result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令失败：${executable}（${result.status ?? "signal"}）`);
}

function hasScript(checkout, name) {
  const packageJson = JSON.parse(readFileSync(path.join(checkout, "package.json"), "utf8"));
  return typeof packageJson.scripts?.[name] === "string";
}

function requireCommand(executable, message) {
  const result = spawnSync(executable, ["--version"], { env: process.env, stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error(message);
}

function acquireLock() {
  mkdir(home);
  try {
    mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const ownerFile = path.join(lockDirectory, "owner.json");
    if (existsSync(ownerFile)) {
      const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
      try { process.kill(owner.pid, 0); throw new Error(`已有本地 CI 任务运行（PID ${owner.pid}）`); }
      catch (signalError) { if (signalError.code !== "ESRCH") throw signalError; }
    }
    rmSync(lockDirectory, { recursive: true, force: true });
    mkdirSync(lockDirectory, { mode: 0o700 });
  }
  writeFileSync(path.join(lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return () => rmSync(lockDirectory, { recursive: true, force: true });
}

function environment(dataDirectory) {
  return {
    ...process.env,
    CI: "1",
    NODE_ENV: "production",
    APP_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    KANBAN_DATA_DIR: dataDirectory,
    PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    PAD_PUBLIC_ORIGIN: "http://localhost:3000",
  };
}

function verifyCheckout(checkout, config, options = {}) {
  const commit = git(checkout, ["rev-parse", "--short", "HEAD"], true);
  const runDirectory = path.join(config.artifacts, `verify-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${commit}`);
  mkdir(runDirectory);
  const logFile = path.join(runDirectory, "ci.log");
  const temporaryData = mkdtempSync(path.join(tmpdir(), "kanban-ci-data-"));
  const env = environment(temporaryData);
  const testEnv = { ...env, APP_ENV: "test", NODE_ENV: "test" };
  delete testEnv.PAD_PUBLIC_ORIGIN;
  const buildEnv = { ...env, APP_ENV: "production", NODE_ENV: "production" };
  const browserSmoke = options.browserSmoke ?? config.browserSmoke;
  try {
    command(checkout, "pnpm", ["install", "--frozen-lockfile"], process.env, logFile);
    command(checkout, "pnpm", ["exec", "next", "typegen"], buildEnv, logFile);
    if (!options.skipBuild && hasScript(checkout, "prebuild")) {
      requireCommand("rustc", "目标提交的 prebuild 需要 Rust；请先安装并让 launchd 的 PATH 包含 rustc，再运行本地 CI");
      requireCommand("cargo", "目标提交的 prebuild 需要 Cargo；请先安装并让 launchd 的 PATH 包含 cargo，再运行本地 CI");
      command(checkout, "pnpm", ["build"], buildEnv, logFile);
    }
    command(checkout, "pnpm", ["typecheck"], testEnv, logFile);
    if (hasScript(checkout, "design:lint")) command(checkout, "pnpm", ["design:lint"], testEnv, logFile);
    command(checkout, "pnpm", ["test:unit"], testEnv, logFile);
    if (!options.skipBuild && !hasScript(checkout, "prebuild")) command(checkout, "pnpm", ["build"], buildEnv, logFile);
    if (browserSmoke) {
      if (options.skipBuild) throw new Error("browser smoke 需要完整构建");
      if (hasScript(checkout, "test:smoke:quick")) command(checkout, "pnpm", ["test:smoke:quick"], testEnv, logFile);
      else if (existsSync(path.join(checkout, "scripts/check-https-auth.mjs"))) command(checkout, process.execPath, ["scripts/check-https-auth.mjs"], testEnv, logFile);
      else throw new Error("未找到浏览器 smoke 入口（test:smoke:quick 或 scripts/check-https-auth.mjs）");
    }
    writeFileSync(path.join(runDirectory, "result.json"), JSON.stringify({ ok: true, commit: git(checkout, ["rev-parse", "HEAD"], true), finishedAt: new Date().toISOString(), browserSmoke, log: logFile }, null, 2) + "\n", { mode: 0o600 });
    return { logFile, runDirectory };
  } catch (error) {
    writeFileSync(path.join(runDirectory, "result.json"), JSON.stringify({ ok: false, commit: git(checkout, ["rev-parse", "HEAD"], true), finishedAt: new Date().toISOString(), error: error.message, log: logFile }, null, 2) + "\n", { mode: 0o600 });
    throw Object.assign(error, { logFile });
  } finally {
    rmSync(temporaryData, { recursive: true, force: true });
  }
}

function ensureCheckout(config) {
  mkdir(path.dirname(config.checkout));
  if (!existsSync(path.join(config.checkout, ".git"))) {
    if (existsSync(config.checkout) && readdirSync(config.checkout).length > 0) throw new Error(`CI checkout 目录非空且不是 Git 仓库：${config.checkout}`);
    command(path.dirname(config.checkout), "git", ["clone", config.repository, config.checkout], process.env, path.join(home, "clone.log"));
  } else git(config.checkout, ["remote", "set-url", "origin", config.repository], true);
  command(config.checkout, "git", ["fetch", "--prune", "--tags", "origin"], process.env, path.join(home, "fetch.log"));
  return config.checkout;
}

function createWorktree(checkout, sha, config) {
  const directory = path.join(config.checkout, ".ci-worktrees", `${sha.slice(0, 12)}-${Date.now()}`);
  mkdir(path.dirname(directory));
  command(checkout, "git", ["worktree", "add", "--detach", directory, sha], process.env, path.join(home, "worktree.log"));
  return directory;
}

function removeWorktree(checkout, directory) {
  try { command(checkout, "git", ["worktree", "remove", "--force", directory], process.env, path.join(home, "worktree.log")); }
  catch { rmSync(directory, { recursive: true, force: true }); }
}

function resolveRef(checkout, ref) { return git(checkout, ["rev-parse", `refs/remotes/origin/${ref}`], true); }

function pruneWorktrees(checkout, config) {
  try { git(checkout, ["worktree", "prune"], true); } catch { /* 下次运行重试。 */ }
  const directory = path.join(config.checkout, ".ci-worktrees");
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory).sort().reverse().slice(config.keepRuns)) rmSync(path.join(directory, entry), { recursive: true, force: true });
}

function repositoryName(repository) {
  const match = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(repository);
  if (!match) throw new Error(`无法从 Git 远程地址解析 GitHub 仓库：${repository}`);
  return match[1];
}

function deployRuntime(worktree, logFile) { command(worktree, "pnpm", ["runtime:update"], process.env, logFile); }

function publishPages(worktree, config, logFile) {
  const pages = mkdtempSync(path.join(tmpdir(), "kanban-pages-"));
  try {
    const authorName = git(worktree, ["config", "--get", "user.name"], true);
    const authorEmail = git(worktree, ["config", "--get", "user.email"], true);
    if (!authorName || !authorEmail) throw new Error("发布 gh-pages 前必须配置当前 Git 身份（user.name 与 user.email）");
    appendFileSync(logFile, `Git 身份：${authorName} <${authorEmail}>\n`);
    command(pages, "git", ["init", "--initial-branch=gh-pages"], process.env, logFile);
    command(pages, "git", ["remote", "add", "origin", config.repository], process.env, logFile);
    command(pages, "git", ["config", "user.name", authorName], process.env, logFile);
    command(pages, "git", ["config", "user.email", authorEmail], process.env, logFile);
    for (const entry of readdirSync(path.join(worktree, "landing"))) cpSync(path.join(worktree, "landing", entry), path.join(pages, entry), { recursive: true });
    command(pages, "git", ["add", "--all"], process.env, logFile);
    command(pages, "git", ["commit", "-m", `Deploy landing ${git(worktree, ["rev-parse", "--short", "HEAD"], true)}`], process.env, logFile);
    const commitIdentity = git(pages, ["log", "-1", "--format=%an <%ae> | %cn <%ce>"], true);
    if (commitIdentity !== `${authorName} <${authorEmail}> | ${authorName} <${authorEmail}>`) throw new Error(`gh-pages 提交身份异常：${commitIdentity}`);
    appendFileSync(logFile, `提交身份核对：${commitIdentity}\n`);
    try { command(pages, "git", ["fetch", "origin", "gh-pages"], process.env, logFile); } catch { /* 首次发布可能还没有 gh-pages。 */ }
    command(pages, "git", ["push", "--force-with-lease", "origin", "HEAD:gh-pages"], process.env, logFile);
  } finally { rmSync(pages, { recursive: true, force: true }); }
}

function publishPluginRelease(worktree, tag, config, logFile) {
  const output = path.join(config.artifacts, tag);
  rmSync(output, { recursive: true, force: true });
  mkdir(config.artifacts);
  const env = { ...process.env, KANBAN_PLUGIN_REPOSITORY: repositoryName(config.repository) };
  command(worktree, "pnpm", ["plugins:release", tag, output], env, logFile);
  const probe = mkdtempSync(path.join(tmpdir(), "kanban-plugin-probe-"));
  try {
    for (const asset of readdirSync(output).filter((entry) => entry.endsWith(".tar.gz")).sort()) command(worktree, "pnpm", ["plugin", "install", path.join(output, asset), "--data-dir", probe], env, logFile);
    command(worktree, "pnpm", ["plugin", "list", "--data-dir", probe], env, logFile);
    command(worktree, "gh", ["release", "create", tag, "--draft", "--verify-tag", "--latest=false", "--title", tag, "--notes", "KanBan 集成插件。请在设置 → 插件中安装。"], env, logFile);
    command(worktree, "gh", ["release", "upload", tag, ...readdirSync(output).map((entry) => path.join(output, entry))], env, logFile);
    command(worktree, "gh", ["release", "edit", tag, "--draft=false", "--latest=false"], env, logFile);
  } finally { rmSync(probe, { recursive: true, force: true }); }
}

function readState() {
  const file = path.join(home, "state.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function writeState(state) {
  mkdir(home);
  writeFileSync(path.join(home, "state.json"), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

function runOnce(config, options) {
  const release = acquireLock();
  const previous = readState();
  try {
    const checkout = ensureCheckout(config);
    const sha = resolveRef(checkout, config.ref);
    const completed = config.deployRuntime ? previous.deployedSha === sha : previous.verifiedSha === sha;
    const pagesCompleted = !config.publishPages || previous.pagesSha === sha;
    if (!options.force && completed && pagesCompleted) {
      writeState({ ...previous, checkedAt: new Date().toISOString(), lastResult: "unchanged", sha });
      console.log(`无新提交：${config.ref} @ ${sha.slice(0, 12)}`);
      return;
    }
    const worktree = createWorktree(checkout, sha, config);
    try {
      const result = verifyCheckout(worktree, config, options);
      if (resolveRef(checkout, config.ref) !== sha) throw new Error(`验证期间 ${config.ref} 已前进，本次不部署`);
      const nextState = { ...previous, verifiedSha: sha, checkedAt: new Date().toISOString(), lastResult: "ok", log: result.logFile };
      if (config.deployRuntime && config.ref === "main" && previous.deployedSha !== sha) {
        deployRuntime(worktree, result.logFile);
        nextState.deployedSha = sha;
        writeState(nextState);
      }
      if (config.publishPages && config.ref === "main" && previous.pagesSha !== sha) {
        publishPages(worktree, config, result.logFile);
        nextState.pagesSha = sha;
      }
      writeState(nextState);
      console.log(`本地 CI 通过：${config.ref} @ ${sha.slice(0, 12)}\n日志：${result.logFile}`);
    } finally {
      removeWorktree(checkout, worktree);
      pruneWorktrees(checkout, config);
    }
  } catch (error) {
    writeState({ ...previous, checkedAt: new Date().toISOString(), lastResult: "failed", error: error.message, log: error.logFile });
    console.error(`本地 CI 失败：${error.message}\n日志：${error.logFile || "请查看 launchd.log"}`);
    process.exitCode = 1;
  } finally { release(); }
}

function verifyCommand(options) {
  const checkout = path.resolve(options.argument || process.cwd());
  if (!existsSync(path.join(checkout, "package.json"))) throw new Error(`不是 KanBan 工作区：${checkout}`);
  const config = { ...defaults, artifacts: path.join(home, "artifacts") };
  mkdir(config.artifacts);
  const result = verifyCheckout(checkout, config, options);
  console.log(`验证通过。日志：${result.logFile}`);
}

const { command: action, options } = parseArgs(process.argv.slice(2));
if (action === "verify") verifyCommand(options);
else if (action === "run") runOnce(readConfig(), options);
else if (action === "status") console.log(existsSync(path.join(home, "state.json")) ? readFileSync(path.join(home, "state.json"), "utf8") : "尚无本地 CI 状态。\n");
else if (action === "pages") { const config = readConfig(); const release = acquireLock(); try { const checkout = ensureCheckout(config); const sha = resolveRef(checkout, config.ref); const worktree = createWorktree(checkout, sha, config); try { publishPages(worktree, config, path.join(config.logs, "pages.log")); } finally { removeWorktree(checkout, worktree); } } finally { release(); } }
else if (action === "release") {
  const tag = options.argument;
  if (!/^plugins-v\d+\.\d+\.\d+$/.test(tag || "")) throw new Error("插件标签必须为 plugins-v1.0.0 形式");
  const config = readConfig();
  const release = acquireLock();
  try {
    const checkout = ensureCheckout(config);
    const sha = git(checkout, ["rev-parse", `refs/tags/${tag}`], true);
    const worktree = createWorktree(checkout, sha, config);
    try {
      const result = verifyCheckout(worktree, config);
      publishPluginRelease(worktree, tag, config, result.logFile);
      console.log(`插件发行已发布：${tag}`);
    } finally { removeWorktree(checkout, worktree); }
  } finally { release(); }
}
else throw new Error("用法：pnpm ci:local verify [目录] | run | pages | status");
