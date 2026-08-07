import { spawn } from "node:child_process";
import process from "node:process";

function readShardCount() {
  const value = process.env.PLAYWRIGHT_SHARDS ?? "2";
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("PLAYWRIGHT_SHARDS 必须是 1 到 4 之间的整数");
  }
  return count;
}

function readBasePort() {
  const value = process.env.PLAYWRIGHT_PORT_BASE ?? "3101";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_527) {
    throw new Error("PLAYWRIGHT_PORT_BASE 必须是 1 到 65527 之间的整数");
  }
  return port;
}

function readRunPrefix() {
  const value = process.env.PLAYWRIGHT_RUN_PREFIX ?? "shard";
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      "PLAYWRIGHT_RUN_PREFIX 只能包含字母、数字、下划线或连字符",
    );
  }
  return value;
}

function runShard({ index, count, basePort, config, runPrefix, testArgs }) {
  const testPort = basePort + index * 2;
  const productionPort = testPort + 1;
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      `--shard=${index + 1}/${count}`,
      ...(config === undefined ? [] : [`--config=${config}`]),
      ...testArgs,
    ],
    {
      env: {
        ...process.env,
        PLAYWRIGHT_TEST_PORT: String(testPort),
        PLAYWRIGHT_PROD_PORT: String(productionPort),
        PLAYWRIGHT_RUN_ID: `${runPrefix}-${index + 1}`,
      },
      stdio: "inherit",
    },
  );

  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve(code === 0 && signal === null);
    });
    child.once("error", () => resolve(false));
  });
}

const count = readShardCount();
const basePort = readBasePort();
const config = process.env.PLAYWRIGHT_CONFIG;
const runPrefix = readRunPrefix();
const testArgs = process.argv.slice(2);
const results = await Promise.all(
  Array.from({ length: count }, (_, index) =>
    runShard({ index, count, basePort, config, runPrefix, testArgs }),
  ),
);

if (results.some((passed) => !passed)) process.exitCode = 1;
