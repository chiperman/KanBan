function readPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.length === 0) return fallback;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数`);
  }
  return port;
}

function readRunId(): string | undefined {
  const value = process.env.PLAYWRIGHT_RUN_ID;
  if (value === undefined || value.length === 0) return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("PLAYWRIGHT_RUN_ID 只能包含字母、数字、下划线或连字符");
  }
  return value;
}

export const TEST_SERVER_PORT = readPort("PLAYWRIGHT_TEST_PORT", 3101);
export const PROD_SERVER_PORT = readPort("PLAYWRIGHT_PROD_PORT", 3102);

export const TEST_BASE_URL = `http://localhost:${TEST_SERVER_PORT}`;
export const PROD_BASE_URL = `http://localhost:${PROD_SERVER_PORT}`;

const runId = readRunId();

export const sharedPlaywrightConfig = {
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 3_000,
  },
  retries: 0,
  workers: 1,
  reporter: "list" as const,
  use: {
    actionTimeout: 3_000,
    baseURL: TEST_BASE_URL,
  },
  ...(runId === undefined ? {} : { outputDir: `test-results/${runId}` }),
};

export const testWebServer = {
  command: `pnpm exec next start -p ${TEST_SERVER_PORT}`,
  port: TEST_SERVER_PORT,
  env: { APP_ENV: "test" },
  reuseExistingServer: false,
  timeout: 120_000,
};
