import { defineConfig } from "@playwright/test";

import {
  PROD_SERVER_PORT,
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: [
    "binance-source.spec.ts",
    "bitget-source.spec.ts",
    "okx-source.spec.ts",
    "test-doubles.spec.ts",
  ],
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
