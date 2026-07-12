// Playwright config for browser-level (E2E) tests.
//
// Layout
// ------
// - Test dir:      ./test/e2e             (matches this project's `test/` convention)
// - Setup project: ./test/e2e/setup/*.setup.ts
//                  Signs in ONCE and writes storageState — no test ever logs in
//                  through the UI (anti-pattern #3 in the E2E rules).
// - Browser project (chromium) depends on `setup` and inherits its storageState,
//   so every spec starts authenticated.
//
// Real vs mocked boundaries
// -------------------------
// This config keeps ALL internal boundaries real (auth cookie, Astro SSR, API
// routes, Supabase, RLS). External services (e.g. OpenRouter) are mocked per
// spec at the network layer when a flow needs it — never in this config.
//
// Environment
// -----------
// - E2E_BASE_URL         (optional, default http://localhost:4321 — astro dev)
// - E2E_USER_EMAIL       (required by auth.setup.ts — the pre-seeded Supabase user)
// - E2E_USER_PASSWORD    (required by auth.setup.ts)

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE = path.join(__dirname, "test", "e2e", ".auth", "user.json");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./test/e2e",

  // Independence is a hard rule — see anti-pattern #3 (shared state).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // Debug artefacts on failure only — cheap in CI, silent locally.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // A concrete-enough wait budget: fail fast, but don't out-race the DB.
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
    },
  ],

  // Boots `astro dev` if nothing is already listening on baseURL. Locally we
  // reuse a dev server the user already has running; in CI we always start a
  // fresh one so the run is hermetic.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
