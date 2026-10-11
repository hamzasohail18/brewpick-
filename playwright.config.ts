// End-to-end tests against a production build (the service worker only runs there).
//   npm run test:e2e        builds, starts on :3100 with its own PGlite database, runs the specs
// Uses the Chrome installed on this machine (channel "chrome"), so no browser download is needed;
// run `npx playwright install chromium` and set E2E_CHANNEL= to use Playwright's own build instead.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const channel = process.env.E2E_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 740 },
        ...(channel ? { channel } : {}),
      },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/offline`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // A separate database, created and seeded (with the fictional sample cafes) on first start.
    env: { PGLITE_DIR: ".data/pglite-e2e" },
  },
});
