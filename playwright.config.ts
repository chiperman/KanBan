import { defineConfig } from "@playwright/test";

import {
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testIgnore: [
    "binance-source.spec.ts",
    "bitget-source.spec.ts",
    "okx-source.spec.ts",
    "test-doubles.spec.ts",
  ],
  webServer: { ...testWebServer },
});

export {
  PROD_BASE_URL,
  PROD_SERVER_PORT,
  TEST_BASE_URL,
  TEST_SERVER_PORT,
} from "./playwright.shared";
