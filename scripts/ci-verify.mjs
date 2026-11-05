import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

try {
  run("pnpm", ["install", "--frozen-lockfile"], process.env);
  run("pnpm", ["exec", "next", "typegen"], buildEnvironment);
  run("pnpm", ["typecheck"], testEnvironment);
  run("pnpm", ["design:lint"], testEnvironment);
  run("pnpm", ["test:unit"], testEnvironment);
  run("pnpm", ["build"], buildEnvironment);
  run("pnpm", ["plugins:verify", "--built"], testEnvironment);
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
