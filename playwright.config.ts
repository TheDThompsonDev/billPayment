import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/browser-results.json" }],
  ],
});
