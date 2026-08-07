import { defineConfig } from "@playwright/test";

import {
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: "source-onboarding-page-flow.spec.ts",
  webServer: { ...testWebServer },
});
