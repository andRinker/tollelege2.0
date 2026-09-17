import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${PORT}`;

// End-to-end tests run a production build against a throwaway in-memory database, with canned
// ISBN lookups, so they never touch .data/pglite, a hosted database, or the network.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    timezoneId: "America/Chicago",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `${E2E_BASE_URL}/sign-in`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      // Values here win over .env.local, which Next only uses for variables that aren't already set.
      DATABASE_URL: "",
      PGLITE_DATA_DIR: "memory://",
      ISBN_LOOKUP_FIXTURES: "1",
      BETTER_AUTH_URL: E2E_BASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      RESEND_API_KEY: "",
    },
  },
});
