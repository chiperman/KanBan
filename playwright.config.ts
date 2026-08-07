import { defineConfig } from "@playwright/test";

import {
  PROD_SERVER_PORT,
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  webServer: [
    { ...testWebServer },
    {
      command: `pnpm exec next start -p ${PROD_SERVER_PORT}`,
      port: PROD_SERVER_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

export {
  PROD_BASE_URL,
  PROD_SERVER_PORT,
  TEST_BASE_URL,
  TEST_SERVER_PORT,
} from "./playwright.shared";
