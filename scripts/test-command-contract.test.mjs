import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const { scripts } = packageJson;
const productionConfig = "playwright.production.config.ts";
const filterArgs = ["e2e/selected flow.spec.ts", "--workers=1"];
const event = (step, args = [], config = null) => ({ step, args, config });
const buildEvents = [event("native-check"), event("next", ["build"])];
const entries = {
  "test:browser:build": { runs: [] },
  "test:browser:test": {
    args: filterArgs,
    runs: [event("playwright", ["test", ...filterArgs])],
  },
  "test:browser:production": {
    args: filterArgs,
    runs: [event("playwright", ["test", `--config=${productionConfig}`, ...filterArgs])],
  },
  "test:browser:parallel": {
    args: filterArgs,
    runs: [event("shards", filterArgs)],
  },
  "test:browser:production:parallel": {
    args: filterArgs,
    runs: [event("shards", filterArgs, productionConfig)],
  },
  "test:browser": {
    runs: [event("shards"), event("shards", [], productionConfig)],
  },
  "test:browser:serial": {
    runs: [event("playwright", ["test"]), event("playwright", ["test", `--config=${productionConfig}`])],
  },
  "test:regression": {
    runs: [event("shards"), event("shards", [], productionConfig)],
  },
};

test("开发门禁、浏览器回归和串行排障命令保持分层", () => {
  assert.equal(
    scripts.test,
    "pnpm typecheck && pnpm test:unit && pnpm test:smoke",
  );
  assert.equal(
    scripts["test:browser:build"],
    "pnpm native:longbridge:check && pnpm exec next build",
  );
  assert.equal(scripts.prebuild, "pnpm native:longbridge:build");
  assert.equal(scripts["test:regression"], "pnpm test:browser");
  assert.deepEqual(
    Object.keys(scripts).filter((name) => name.startsWith("test:browser") || name === "test:regression").sort(),
    Object.keys(entries).sort(),
  );
});

function runCommand(t, name, { failAt = "", args = [] } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "kanban-command-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "node_modules/.bin");
  const trace = path.join(directory, "trace.jsonl");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(directory, "scripts"));
  mkdirSync(path.join(directory, ".next"));
  writeFileSync(path.join(directory, ".next/BUILD_ID"), "stale-build");
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({
    name: "kanban-command-contract", private: true, type: "module",
    packageManager: packageJson.packageManager, scripts,
  }));
  // 真正执行 pnpm 和 shell 的命令链；只替换昂贵或有外部副作用的叶子命令。
  const recorder = path.join(directory, "record.mjs");
  writeFileSync(recorder, `
import { appendFileSync } from "node:fs";
export function record(step) {
  const entry = { step, args: process.argv.slice(2), config: process.env.PLAYWRIGHT_CONFIG ?? null };
  appendFileSync(process.env.COMMAND_TRACE, JSON.stringify(entry) + "\\n");
  if (process.env.COMMAND_FAIL_AT === step) process.exit(23);
}
`);
  for (const [file, step] of [
    ["scripts/native-artifact.mjs", "native-check"],
    ["scripts/build-longbridge-keychain-sdk.mjs", "native-build"],
    ["scripts/run-playwright-shards.mjs", "shards"],
    ["node_modules/.bin/next", "next"],
    ["node_modules/.bin/playwright", "playwright"],
  ]) {
    writeFileSync(path.join(directory, file),
      `#!/usr/bin/env node\nimport { record } from ${JSON.stringify(pathToFileURL(recorder).href)};\nrecord(${JSON.stringify(step)});\n`,
      { mode: 0o755 });
  }
  const env = {
    ...process.env,
    COMMAND_TRACE: trace,
    COMMAND_FAIL_AT: failAt,
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    // 临时工程没有真实依赖，禁止 pnpm 自动安装或触发 preinstall。
    pnpm_config_verify_deps_before_run: "false",
    npm_config_update_notifier: "false",
  };
  delete env.PLAYWRIGHT_CONFIG;
  const result = spawnSync("pnpm", ["--config.verify-deps-before-run=false", "run", name, ...args], {
    cwd: directory, env, encoding: "utf8", timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  const events = existsSync(trace)
    ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { ...result, events };
}

for (const [name, { runs, args }] of Object.entries(entries)) {
  test(`${name} 先校验原生扩展且只构建一次，再按环境和参数运行`, (t) => {
    const result = runCommand(t, name, { args });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.events, [...buildEvents, ...runs]);
  });

  for (const [failAt, count] of [["native-check", 1], ["next", 2]]) {
    test(`${name} 在 ${failAt} 失败时停止，不使用遗留构建继续测试`, (t) => {
      const result = runCommand(t, name, { failAt });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.events, buildEvents.slice(0, count));
    });
  }
}

for (const name of ["test:browser", "test:browser:serial", "test:regression"]) {
  test(`${name} 普通环境测试失败后不继续生产环境测试`, (t) => {
    const firstRun = entries[name].runs[0];
    const result = runCommand(t, name, { failAt: firstRun.step });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, [...buildEvents, firstRun]);
  });
}
