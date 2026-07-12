// E2E auth setup — signs in ONCE per run and writes the resulting Supabase
// session cookie into a storageState file. Every spec picks up that state via
// the `chromium` project (see playwright.config.ts), so no test ever drives
// the sign-in form itself (anti-pattern #3, "shared state" — but inverted: a
// dedicated setup project is the sanctioned way to skip the auth UI).
//
// The setup deliberately DOES use the UI to sign in (rather than injecting a
// cookie directly). Rationale: this exercises the real /api/auth/signin route
// once, which pins the same integration risks the app boots on top of — if
// sign-in itself breaks, every downstream spec fails loudly at setup time.
//
// Environment (both required):
//   - E2E_USER_EMAIL     — a pre-seeded Supabase user, email-confirmed
//   - E2E_USER_PASSWORD  — that user's password
//
// The user must exist before Playwright runs. Seed it once via the local
// Supabase admin API or reuse the integration test user
// (test/helpers/integration-user.ts:TEST_USER_EMAIL).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { expect, test as setup } from "@playwright/test";

const authFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".auth", "user.json");
const devVarsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".dev.vars");

const DEFAULT_E2E_USER_EMAIL = "test@integration.local";
const DEFAULT_E2E_USER_PASSWORD = "integration-test-password";

let cachedDevVars: Partial<Record<string, string>> | null = null;

function loadDevVarsFile() {
  if (cachedDevVars) {
    return cachedDevVars;
  }

  const loaded: Partial<Record<string, string>> = {};

  try {
    if (!fs.existsSync(devVarsPath)) {
      cachedDevVars = loaded;
      return loaded;
    }

    const content = fs.readFileSync(devVarsPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separator = line.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      loaded[key] = value;
    }
  } catch {
    // Best-effort fallback only; explicit env vars still work.
  }

  cachedDevVars = loaded;
  return loaded;
}

function readSecret(name: string) {
  return process.env[name] ?? loadDevVarsFile()[name];
}

async function ensureE2EUserExists(email: string, password: string) {
  const supabaseUrl = readSecret("SUPABASE_URL") ?? readSecret("TEST_SUPABASE_URL");
  const serviceRoleKey = readSecret("SUPABASE_SERVICE_ROLE_KEY") ?? readSecret("TEST_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error && error.code !== "email_exists" && error.message !== "User already registered") {
    throw new Error(`Failed to ensure E2E user exists: ${error.message}`);
  }
}

setup("authenticate the E2E user and persist storageState", async ({ page }) => {
  const email =
    process.env.E2E_USER_EMAIL ?? process.env.TEST_USER_EMAIL ?? readSecret("E2E_USER_EMAIL") ?? DEFAULT_E2E_USER_EMAIL;
  const password =
    process.env.E2E_USER_PASSWORD ??
    process.env.TEST_USER_PASSWORD ??
    readSecret("E2E_USER_PASSWORD") ??
    DEFAULT_E2E_USER_PASSWORD;

  await ensureE2EUserExists(email, password);

  // PLAN: land on the sign-in page and submit the form. We wait for the POST
  // response (state), not a timeout — the redirect from /api/auth/signin is
  // what proves the cookie was set.
  await page.goto("/auth/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);

  // Wait for the post-signin redirect: on success we land off /auth/signin (home
  // page); on failure the app bounces back to /auth/signin?error=... — both
  // satisfy the predicate so we can then inspect page.url() to detect the error
  // branch. Deliberately not using waitForLoadState("networkidle"), which is a
  // Playwright-discouraged heuristic (see e2e anti-pattern #4 — wait for state,
  // not for time-adjacent signals).
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/auth/signin" || url.searchParams.has("error"), {
      timeout: 15_000,
    }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);

  if (page.url().includes("/auth/signin")) {
    const url = new URL(page.url());
    const error = url.searchParams.get("error") ?? "unknown error";
    throw new Error(
      `E2E sign-in failed: ${error}. Set E2E_USER_EMAIL/E2E_USER_PASSWORD to a valid account or provide SUPABASE_SERVICE_ROLE_KEY to auto-provision the default test user.`,
    );
  }

  // Belt + braces: assert we're authenticated before freezing storageState.
  // This app lands on the home page after sign-in, so we assert signed-in UI
  // controls rather than a /dashboard heading.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
