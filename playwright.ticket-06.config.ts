import { defineConfig } from "@playwright/test";

import {
  sharedPlaywrightConfig,
  testWebServer,
} from "./playwright.shared";

export default defineConfig({
  ...sharedPlaywrightConfig,
  testMatch: [
    "settings-security-consolidation.spec.ts",
    "credential-free-backup-restore.spec.ts",
    "recovery-session-lock.spec.ts",
  ],
  webServer: { ...testWebServer },
});
