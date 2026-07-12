/**
 * Post-build patch: wraps the Cloudflare adapter's generated entry.mjs
 * in Sentry.withSentry() so that SENTRY_DSN from Workers bindings is used
 * at runtime to initialise the SDK.
 *
 * Why this is needed: @astrojs/cloudflare 13+ uses a "redirected config"
 * mechanism — wrangler reads dist/server/wrangler.json instead of the root
 * wrangler.jsonc, so any `main` override in wrangler.jsonc is ignored.
 * This script patches the redirected config after every build.
 *
 * @sentry/cloudflare must be bundled into the entry file because Cloudflare
 * Workers runtime has no access to node_modules at runtime. We use esbuild
 * (already a transitive dep) to produce a self-contained bundle.
 */

import { readFileSync, writeFileSync } from "fs";
import esbuild from "esbuild";

const WRANGLER_JSON = "dist/server/wrangler.json";
const SENTRY_ENTRY = "sentry.entry.mjs";
const SENTRY_ENTRY_SRC = "sentry.entry.src.mjs";

const config = JSON.parse(readFileSync(WRANGLER_JSON, "utf-8"));
const originalMain = config.main; // e.g. "entry.mjs"

// 1. Write the unbundled source for esbuild to process
const srcPath = `dist/server/${SENTRY_ENTRY_SRC}`;
writeFileSync(
  srcPath,
  `import * as Sentry from "@sentry/cloudflare";
import handler from "./${originalMain}";

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  }),
  handler,
);
`,
);

// 2. Bundle with esbuild — inlines @sentry/cloudflare, keeps entry.mjs + chunks external
await esbuild.build({
  entryPoints: [srcPath],
  outfile: `dist/server/${SENTRY_ENTRY}`,
  bundle: true,
  format: "esm",
  platform: "browser", // Workers runtime — no Node built-ins
  conditions: ["worker", "browser"],
  external: [
    // Keep Cloudflare runtime imports external
    "cloudflare:*",
    // node:* is provided by Workers nodejs_compat layer at runtime
    "node:*",
    // Keep Astro-generated chunks external (already uploaded as modules)
    `./${originalMain}`,
    "./chunks/*",
    "./virtual_astro_middleware.mjs",
  ],
  allowOverwrite: true,
  logLevel: "warning",
});

// 3. Redirect wrangler to use the bundled wrapper
config.main = SENTRY_ENTRY;
writeFileSync(WRANGLER_JSON, JSON.stringify(config, null, 2));

console.log(
  `[patch-sentry-entry] dist/server/${SENTRY_ENTRY} bundled, ${WRANGLER_JSON}: main ${originalMain} → ${SENTRY_ENTRY}`,
);
