import { defineConfig } from "@playwright/test";

import {
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: [
    "overview-layout-mode.spec.ts",
    "workbench-shell-navigation.spec.ts",
  ],
  webServer: { ...testWebServer },
});
