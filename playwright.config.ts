import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
    viewport: { width: 1512, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: { DATA_DIR: path.join(tmpdir(), "prospectai-browser-tests"), PORT: "3201", API_PORT: "3201", VITE_PORT: "5174", APP_PASSWORD: "", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", EMAIL_ENABLED: "false", APIFY_TOKEN: "", AI_API_KEY: "", VERCEL_TOKEN: "" },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
