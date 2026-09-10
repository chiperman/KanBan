import { defineConfig } from "@playwright/test";

import {
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: [
    "asset-refresh-workbench.spec.ts",
    "source-list-detail-lifecycle.spec.ts",
  ],
  webServer: testWebServer,
});
