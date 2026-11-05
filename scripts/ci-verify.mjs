import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(process.cwd());
const evidence = { status: "running", commit: process.env.GITHUB_SHA || null, startedAt: new Date().toISOString(), steps: [] };
function saveEvidence() {
  if (!process.env.KANBAN_CI_HOME) return;
  mkdirSync(process.env.KANBAN_CI_HOME, { recursive: true });
  writeFileSync(path.join(process.env.KANBAN_CI_HOME, "verification.json"), JSON.stringify(evidence, null, 2) + "\n");
}
const dataDirectory = mkdtempSync(path.join(tmpdir(), "kanban-ci-data-"));
const baseEnvironment = {
  ...process.env,
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  KANBAN_DATA_DIR: dataDirectory,
  PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const testEnvironment = { ...baseEnvironment, APP_ENV: "test", NODE_ENV: "test" };
const buildEnvironment = { ...baseEnvironment, APP_ENV: "production", NODE_ENV: "production", PAD_PUBLIC_ORIGIN: "http://localhost:3000" };

function run(command, args, env) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  evidence.steps.push({
    command: [command, ...args].join(" "), durationMs: Date.now() - started,
    status: result.status === 0 ? "passed" : "failed", exitCode: result.status, signal: result.signal,
  });
  saveEvidence();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败（${result.status ?? "signal"}）`);
}

function pluginsChanged() {
  if (!process.env.GITHUB_EVENT_PATH) return true;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const base = event.pull_request?.base?.sha ?? event.before;
  if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base)) return true;
  const diff = spawnSync("git", ["diff", "--name-only", base, "HEAD"], { cwd: root, encoding: "utf8" });
  if (diff.status !== 0 || diff.error) return true;
  return diff.stdout.split("\n").some(file =>
    /^(plugins\/|src\/|scripts\/|\.github\/workflows\/|package\.json$|pnpm-lock\.yaml$|tsconfig\.json$|\.node-version$)/.test(file));
}

try {
  run("pnpm", ["install", "--frozen-lockfile"], process.env);
  run("pnpm", ["exec", "next", "typegen"], buildEnvironment);
  run("pnpm", ["typecheck"], testEnvironment);
  run("pnpm", ["design:lint"], testEnvironment);
  run("pnpm", ["test:unit"], testEnvironment);
  if (pluginsChanged()) run("pnpm", ["plugins:verify"], testEnvironment);
  else console.log("本次未修改插件、源码或构建链路，跳过插件打包试装。");
  run("pnpm", ["build"], buildEnvironment);
  evidence.status = "passed";
  console.log("CI 验证通过：类型、设计、单测和生产构建全部完成。");
} catch (error) {
  evidence.status = "failed";
  throw error;
} finally {
  evidence.completedAt = new Date().toISOString();
  saveEvidence();
  rmSync(dataDirectory, { recursive: true, force: true });
}
