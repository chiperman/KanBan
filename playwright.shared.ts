export const TEST_SERVER_PORT = 3101;
export const PROD_SERVER_PORT = 3102;

export const TEST_BASE_URL = `http://localhost:${TEST_SERVER_PORT}`;
export const PROD_BASE_URL = `http://localhost:${PROD_SERVER_PORT}`;

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
};

export const testWebServer = {
  command: `pnpm exec next start -p ${TEST_SERVER_PORT}`,
  port: TEST_SERVER_PORT,
  env: { APP_ENV: "test" },
  reuseExistingServer: false,
  timeout: 120_000,
};
