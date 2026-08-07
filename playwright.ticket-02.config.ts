import { defineConfig } from "@playwright/test";

const TEST_SERVER_PORT = 3101;
const TEST_BASE_URL = `http://localhost:${TEST_SERVER_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "overview-layout-mode.spec.ts",
  timeout: 30_000,
  expect: {
    timeout: 3_000,
  },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    actionTimeout: 3_000,
    baseURL: TEST_BASE_URL,
  },
  webServer: {
    command: `pnpm exec next start -p ${TEST_SERVER_PORT}`,
    port: TEST_SERVER_PORT,
    env: { APP_ENV: "test" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
