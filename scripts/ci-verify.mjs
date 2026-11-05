import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(process.cwd());
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
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
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
  console.log("CI 验证通过：类型、设计、单测和生产构建全部完成。");
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
