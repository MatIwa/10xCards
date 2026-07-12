# Sentry monitoring runbook

Operational reference for the Sentry integration added by change `sentry-monitoring`.

## Architecture summary

- **Client SDK**: `@sentry/astro` registered as an Astro integration in [astro.config.mjs](../../../astro.config.mjs). Client-side capture is dormant (no `PUBLIC_SENTRY_DSN` set) — registering the integration is what enables the Astro 6 + Cloudflare 13+ auto-detection path (Sentry issue [#19762](https://github.com/getsentry/sentry-javascript/issues/19762)) and also injects `sentry-trace` / `baggage` meta tags into SSR HTML.
- **Server SDK**: `@sentry/cloudflare` wrapped around the adapter's generated `entry.mjs` via a postbuild patch. Runtime DSN comes from Cloudflare Workers bindings (`env.SENTRY_DSN`).
- **DSN**: empty → SDK runs in no-op mode (dev / test / CI). Set → events flow to Sentry.
- **Console interception**: `captureConsoleIntegration({ levels: ["warn", "error"] })` sends `console.warn` and `console.error` calls as Sentry events. Shares the 5000-event/mo Free-plan budget with unhandled exceptions.

## How the custom entry point is wired

Astro's `@astrojs/cloudflare` 13+ adapter uses a **redirected wrangler configuration** — after `astro build`, wrangler reads `dist/server/wrangler.json` (not the root [wrangler.jsonc](../../../wrangler.jsonc)) and its `main` always points at the raw adapter entry `entry.mjs`. Any `main` override in the root `wrangler.jsonc` is silently ignored.

The workaround lives in [scripts/patch-sentry-entry.mjs](../../../scripts/patch-sentry-entry.mjs), registered as a `postbuild` npm hook in [package.json](../../../package.json):

1. Reads `dist/server/wrangler.json`, notes the original `main` (e.g., `entry.mjs`).
2. Writes `dist/server/sentry.entry.src.mjs` — a small source file that imports `@sentry/cloudflare` and re-exports `Sentry.withSentry(configFactory, handler)`.
3. Runs esbuild to bundle the wrapper into `dist/server/sentry.entry.mjs`, inlining `@sentry/cloudflare` (Workers runtime has no `node_modules`). Externals: `cloudflare:*`, `node:*` (handled by `nodejs_compat`), the original `entry.mjs`, and `./chunks/*`.
4. Patches `dist/server/wrangler.json` so `main = "sentry.entry.mjs"`.

Verify after a build:

```powershell
Get-Content dist\server\wrangler.json | ConvertFrom-Json | Select-Object main
# → main: sentry.entry.mjs
Select-String -Path dist\server\sentry.entry.mjs -Pattern "withSentry" -List
# → LineNumber ~8000+ (proves @sentry/cloudflare is inlined)
```

## Provisioning a Sentry project

1. Log in to [sentry.io](https://sentry.io). Free Developer plan is enough for a course project (5000 events/mo, 30-day retention).
2. Create a new project. Any JavaScript platform works — Sentry projects are runtime-agnostic; the DSN accepts events from any SDK. Recommended platform label: **Cloudflare Workers** (only affects onboarding UI hints).
3. Settings → Projects → *your project* → **Client Keys (DSN)**. Copy the DSN. Format: `https://<key>@o<org>.ingest.<region>.sentry.io/<project>`.

## Setting the DSN

### Local dev (`wrangler dev`)

Put the DSN in `.dev.vars` (gitignored):

```
SENTRY_DSN=https://<key>@o<org>.ingest.<region>.sentry.io/<project>
```

For pure `astro dev` (Node runtime, no Workers): DSN is not used — Sentry only activates through the Cloudflare wrapper, which only runs under `wrangler dev` or on deployed Workers.

**Caveat**: `wrangler dev` on Windows sometimes fails to flush Sentry events at request end (short-lived local Worker context). Production is the reliable smoke-test target.

### Production (Cloudflare Workers)

```powershell
npx wrangler secret put SENTRY_DSN
# Paste the DSN when prompted.
```

Rotate later by running the same command again.

### CI

Not required. `npm run lint` and `npm run build` are DSN-agnostic — the SDK's no-op mode kicks in when DSN is empty.

## Deploying

```powershell
npm run deploy
# = npm run build (which triggers postbuild patch) && wrangler deploy
```

Expected output snippet:

```
> node scripts/patch-sentry-entry.mjs
[patch-sentry-entry] dist/server/sentry.entry.mjs bundled, dist/server/wrangler.json: main entry.mjs → sentry.entry.mjs
...
Uploaded 10xcards (...)
Deployed 10xcards triggers (...)
  https://10xcards.<account>.workers.dev
```

## Smoke-testing on production

The most reliable smoke test is a temporary uncaught error in the middleware, gated by a query param:

```ts
// src/middleware.ts — TEMP
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.searchParams.has("sentry-test")) {
    throw new Error("sentry smoke: uncaught middleware error");
  }
  // ...rest of middleware
});
```

Deploy, then trigger:

```powershell
try {
  Invoke-WebRequest -Uri "https://10xcards.<account>.workers.dev/auth/signin?sentry-test=1" -UseBasicParsing
} catch {
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
}
# Expected: Status: 500
```

Within ~1 minute, an issue titled `Error: sentry smoke: uncaught middleware error` appears in **Sentry → Issues**. The stack trace top frame points at `sentry.entry.mjs:*` — the proof the wrapper is live.

**Remove the trigger code and redeploy.** Verify the trigger is gone: same URL should return 200 again.

## Budget management

- Free-plan cap: **5000 events / month**, resets on the first of the month.
- `captureConsoleIntegration({ levels: ["warn", "error"] })` shares the budget. If any hot path spams `console.warn`, the budget can burn in hours.
- Watch: **Sentry → Stats** for the current month's usage.
- Levers if the budget starts hurting:
  - Narrow to `levels: ["error"]` only (edit [scripts/patch-sentry-entry.mjs](../../../scripts/patch-sentry-entry.mjs) and rebuild).
  - Drop `captureConsoleIntegration` entirely; add explicit `Sentry.captureException(err)` at points that matter.
  - Increase sampling filters via Sentry project settings (Inbound Filters).

## Not covered by this change

- **Source-map upload** — requires `SENTRY_AUTH_TOKEN` and a build-time upload step. Deferred; production stack traces are still meaningful without it.
- **Performance / tracing / session replay** — all disabled by default. Enable per-need by adding `tracesSampleRate`, `replaysSessionSampleRate`, etc. to the config factory in [scripts/patch-sentry-entry.mjs](../../../scripts/patch-sentry-entry.mjs).
- **Client-side error capture** — the `@sentry/astro` integration is registered but `PUBLIC_SENTRY_DSN` is intentionally not set. To enable, add `PUBLIC_SENTRY_DSN` to Astro's env schema and pass it as `dsn` to `sentry({ dsn: ... })` in [astro.config.mjs](../../../astro.config.mjs).
- **PII scrubbing** — Sentry defaults (`sendDefaultPii: false`) are in effect; no custom scrubbing.
