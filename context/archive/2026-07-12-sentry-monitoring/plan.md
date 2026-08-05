# Sentry error monitoring — Implementation Plan

## Overview

Wire Sentry error monitoring into 10xCards (Astro 6.3.1 SSR + Cloudflare Workers). Install `@sentry/astro` (client bundle + Astro build integration) and `@sentry/cloudflare` (Workers server-side handler), route the Cloudflare adapter through a custom entry point that wraps the Astro handler in `Sentry.withSentry()`, enable `captureConsoleIntegration({ levels: ["warn", "error"] })` so swallowed `console.warn/error` calls surface as issues, and keep the whole thing no-op when `SENTRY_DSN` is empty so dev / test / preview environments require no extra config.

## Current State Analysis

- **No Sentry today.** No `@sentry/*` package in [package.json](../../../package.json); no error-reporting SDK anywhere in `src/`.
- **Astro 6.3.1 + `@astrojs/cloudflare` 13.5.0 + `output: "server"`.** [astro.config.mjs](../../../astro.config.mjs) declares Cloudflare as adapter, uses `envField` for typed server secrets, and consumes them from `astro:env/server`.
- **`nodejs_compat` already on.** [wrangler.jsonc](../../../wrangler.jsonc) has `"compatibility_flags": ["nodejs_compat"]`, and `main` is the default `"@astrojs/cloudflare/entrypoints/server"` — this is the exact line the plan replaces.
- **Secrets pattern established.** `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` are all declared in `envField.string({ context: "server", access: "secret", optional: true })` and documented in [.env.example](../../../.env.example). `SENTRY_DSN` follows the same shape.
- **No Cloudflare `Env` type on hand.** The `withSentry` factory signature `(env: Env) => ({ dsn: ... })` needs `env` typed — Astro's Cloudflare adapter uses `Runtime<Env>` for locals, but the raw Worker entry point receives the platform bindings directly. In practice `env.SENTRY_DSN` is a `string | undefined` from Cloudflare's bindings interface.

## Desired End State

- `npm install` resolves `@sentry/astro` and `@sentry/cloudflare` (both `^10.44.0` — the version that officially supports the Astro 6 custom entry point per [Sentry issue #19762](https://github.com/getsentry/sentry-javascript/issues/19762)).
- `sentry.server.config.ts` sits at repo root and exports the `Sentry.withSentry(...)` wrapper around `@astrojs/cloudflare/entrypoints/server`.
- [wrangler.jsonc](../../../wrangler.jsonc) `main` points at `./sentry.server.config.ts`.
- [astro.config.mjs](../../../astro.config.mjs) has (a) `SENTRY_DSN` in the env schema and (b) the `sentry()` integration from `@sentry/astro` registered so the client bundle also emits browser errors when a DSN is set.
- [.env.example](../../../.env.example) documents `SENTRY_DSN` with a comment pointing at the Sentry project settings page.
- With `SENTRY_DSN` empty (dev / test / preview / CI), the SDK initialises in **no-op** mode — events are captured but never sent, so no external network call is made and no test needs a mock.
- With `SENTRY_DSN` set (deployed Workers env), a thrown error inside any API route or a `console.warn("test-sentry")` in a page produces an issue in the Sentry dashboard within seconds.
- `npm run build` stays green. `npm run lint` stays green.

**Verification**: `npm run build` succeeds. `npx wrangler deploy --dry-run` succeeds (proves the custom entry point resolves in the Workers bundle). Manual smoke: with a real DSN in `.dev.vars`, `npm run dev` → visit a page that calls `console.error("sentry smoke")` → issue appears in Sentry.

### Key Discoveries

- The user's brief pins the exact recipe: `Sentry.withSentry((env) => ({ dsn, integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })] }), handler)`. No design choice to make here — implement as specified.
- `captureConsoleIntegration` shares the same monthly issue budget (5000 on Free) as unhandled exceptions. At current traffic (course project) this is intentional — maximise visibility now, narrow `levels` later if the budget starts hurting.
- The Astro 6 + Cloudflare adapter 13+ integration path was blocked before `@sentry/astro` 10.44.0 (see [issue #19762](https://github.com/getsentry/sentry-javascript/issues/19762)). Pinning `^10.44.0` is not optional.
- No-op mode when DSN is empty is a first-class SDK behaviour — this is the whole reason we don't need a `.env.example` value or env-branching wrapper. Same file ships to every environment.

## What We're NOT Doing

- **Not adding source-map upload.** Requires a Sentry auth token, `@sentry/wizard`, and a build-time upload step. Deferred — 5000-event Free plan gets meaningful stack traces from the deployed Workers bundle without SourceMap upload; upload is a nice-to-have that adds CI complexity.
- **Not adding performance / tracing / session-replay.** `tracesSampleRate`, `replaysSessionSampleRate`, and `replaysOnErrorSampleRate` all stay unset (default 0). Errors first; performance later if traffic warrants it.
- **Not scrubbing PII or redacting request bodies.** Sentry defaults (`sendDefaultPii: false`) are fine at this stage. No user emails or Supabase tokens should end up in error stacks anyway — the auth flow uses `@supabase/ssr` cookies, not headers we log.
- **Not narrowing `captureConsoleIntegration` levels beyond `["warn", "error"]`.** The user's brief calls out that narrowing (or switching to explicit `Sentry.captureException`) is a *later* scaling move, not a v0 concern.
- **Not adding a Sentry-init helper in `src/lib/`.** The config lives in `sentry.server.config.ts` at repo root because that's what the Cloudflare adapter's custom entry point contract requires — moving it into `src/` would break the Workers bundle.
- **Not wiring Sentry into unit / integration / e2e tests.** No-op mode means the tests already work without any change. Test-mocking `astro:env/server` (see [src/lib/services/ai-generation.service.test.ts:7](../../../src/lib/services/ai-generation.service.test.ts)) does not need to be extended.
- **Not touching CI ([.github/workflows/ci.yml](../../../.github/workflows/ci.yml)).** CI runs `npm run lint` and `npm run build`. Both are DSN-agnostic. No new secret needed in the CI env.
- **Not adding Sentry alerts, dashboards, or Slack integrations.** Sentry project setup on sentry.io is manual and out of scope for the code change.

## Implementation Approach

Two phases, each independently verifiable and commit-worthy.

**Phase 1** does the whole code change — packages, custom entry point, `wrangler.jsonc`, env schema, `astro.config.mjs` integration, `.env.example` doc. All of it is atomic: the app must build clean with `SENTRY_DSN` empty *and* with a real DSN in `.dev.vars`. Verification is `npm run build` + `npx wrangler deploy --dry-run`.

**Phase 2** is manual smoke — provision a Sentry project on sentry.io, drop the real DSN into `.dev.vars` and Cloudflare Workers secrets, deliberately throw / `console.error` from a page and confirm the issue lands in the dashboard. No code changes in this phase; just documentation of the runbook in `context/changes/sentry-monitoring/` for the archive.

> **Post-implementation correction (2026-07-12)**: the original Phase 1 plan pointed root `wrangler.jsonc.main` at a `sentry.server.config.ts` wrapper. During Phase 2 smoke testing we discovered `@astrojs/cloudflare` 13+ uses a **redirected wrangler config** (`dist/server/wrangler.json`) that silently overrides `main` back to the raw adapter entry — so no Sentry wrapping ever reached the deployed Worker. The fix, now shipped, is a `postbuild` hook ([scripts/patch-sentry-entry.mjs](../../../scripts/patch-sentry-entry.mjs)) that bundles the wrapper with esbuild directly into `dist/server/sentry.entry.mjs` and patches `dist/server/wrangler.json` to point at it. Root `wrangler.jsonc` is left with the adapter default. See [context/foundation/lessons.md](../../foundation/lessons.md) → "Astro 6 + `@astrojs/cloudflare` 13+: custom `main` in `wrangler.jsonc` is silently ignored" and [runbook.md](./runbook.md).

## Critical Implementation Details

### Custom entry point contract with `@astrojs/cloudflare` 13+

`@astrojs/cloudflare/entrypoints/server` exports the Astro-generated Worker `fetch` handler as its **default export**. The custom entry point re-exports a Sentry-wrapped version of that handler. The wrapper is `Sentry.withSentry(configFactory, handler)`, where `configFactory` receives the Cloudflare bindings (`env`) at request time and returns `{ dsn, integrations, ... }`. Because config is per-request from bindings, no top-level `Sentry.init(...)` call runs during module evaluation — which is what makes the DSN-empty no-op behaviour safe on Workers cold-start.

`wrangler.jsonc` `main` MUST point at the transpiled entry (`./sentry.server.config.ts`, TypeScript source — `wrangler` compiles it via esbuild), not at the compiled `dist/_worker.js/` output. The Astro build still writes `dist/_worker.js/index.js`; the custom entry point imports through the `@astrojs/cloudflare/entrypoints/server` package specifier which resolves to whatever the adapter installed, so the Astro build output remains the actual code being run — the wrapper just intercepts the export.

### Env schema is optional and untyped in `sentry.server.config.ts`

`astro:env/server` cannot be imported from `sentry.server.config.ts` — that file runs at the Workers entry level, *outside* the Astro app boundary where the `astro:env/server` virtual module exists. Instead, `configFactory` receives `env` (Cloudflare bindings) which contains `env.SENTRY_DSN` as `string | undefined`. The `envField.string({ ..., optional: true })` in [astro.config.mjs](../../../astro.config.mjs) still applies to any Astro-side code that wants to read `SENTRY_DSN` (e.g., a future feature-flag) but the wrapper does not go through it.

For local dev under `wrangler dev`, `SENTRY_DSN` is read from `.dev.vars`. In deployed Workers, it comes from `wrangler secret put SENTRY_DSN`.

### `@sentry/astro` integration — client-side only when DSN is set

The `sentry()` Astro integration from `@sentry/astro` injects a client-side `Sentry.init` call into the browser bundle. Configure it with `{ dsn: import.meta.env.PUBLIC_SENTRY_DSN, ... }` — but we deliberately do **not** expose a `PUBLIC_SENTRY_DSN` yet, because (a) the browser-side Sentry allowlist is a separate Sentry project concern, (b) client-side JS errors on Astro SSR pages are relatively rare (most logic runs on the server via API routes), and (c) it doubles the event budget consumption for uncertain value at this stage. Register the integration with an empty/omitted `dsn` — the integration becomes a no-op and adds no bytes to the client bundle when DSN is unset. Wire the `PUBLIC_SENTRY_DSN` env var in a follow-up change when we actually want browser error capture.

**Correction on second thought**: `@sentry/astro` at 10.44+ *auto-detects* the Cloudflare adapter and coordinates the server-side config injection point. Registering it in `astro.config.mjs` is what enables that auto-detection path, so even though we don't want client-side capture now, the integration MUST be registered for the server-side wrapper to be considered "supported" per issue #19762. Config the integration with `{ sourceMapsUploadOptions: { enabled: false } }` to disable source-map upload (out of scope this change).

### `.dev.vars` vs `.env.example` documentation

`.env.example` documents `SENTRY_DSN=###` alongside the other secrets. The comment tells the reader **"leave empty in dev — no-op"** and links to `https://sentry.io/settings/projects/<project>/keys/` for where to get a real DSN. `.dev.vars` (gitignored, per [AGENTS.md](../../../AGENTS.md)) is where a developer optionally drops a real DSN when they want to test the wiring end-to-end.

## Phase 1: Install packages, custom entry point, env plumbing

### Overview

Land the entire code change in one atomic commit. After this phase, the app builds clean with DSN empty (no-op) and produces real Sentry events when a DSN is present.

### Changes Required

#### 1. `package.json` — add Sentry deps

Install `@sentry/astro` and `@sentry/cloudflare` (both `^10.44.0`).

```
npm install --save @sentry/astro@^10.44.0 @sentry/cloudflare@^10.44.0
```

#### 2. `sentry.server.config.ts` — new file at repo root

```ts
import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

interface CloudflareEnv {
  SENTRY_DSN?: string;
}

export default Sentry.withSentry(
  (env: CloudflareEnv) => ({
    dsn: env.SENTRY_DSN,
    // Surface swallowed console.warn / console.error as Sentry events.
    // Shares the 5000-event/mo Free budget with unhandled exceptions;
    // narrow to ["error"] or move to explicit captureException when traffic grows.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
    // Empty DSN → SDK initialises in no-op mode; safe to ship to every env.
  }),
  handler,
);
```

#### 3. [wrangler.jsonc](../../../wrangler.jsonc) — point `main` at the wrapper

Change:
```jsonc
"main": "@astrojs/cloudflare/entrypoints/server",
```
to:
```jsonc
"main": "./sentry.server.config.ts",
```

Nothing else in `wrangler.jsonc` changes — `nodejs_compat` is already on.

#### 4. [astro.config.mjs](../../../astro.config.mjs) — env schema + integration

- Add `SENTRY_DSN: envField.string({ context: "server", access: "secret", optional: true })` to the `env.schema` block.
- Import `sentry` from `@sentry/astro` and register it in `integrations: [react(), sitemap(), sentry({ sourceMapsUploadOptions: { enabled: false } })]`.

Note: no `dsn` passed to `sentry({...})`. Client-side capture stays dormant (no `PUBLIC_SENTRY_DSN` today). Registering the integration is what unlocks the Astro 6 + Cloudflare adapter server-side wrapper path per [Sentry issue #19762](https://github.com/getsentry/sentry-javascript/issues/19762).

#### 5. [.env.example](../../../.env.example) — document the new secret

Append:
```
SENTRY_DSN= # Optional — leave empty for no-op mode. Get from https://sentry.io/settings/projects/<project>/keys/
```

### Success Criteria

#### Automated

- [ ] 1.1 `npm install` resolves clean, no peer-dep warnings from `@sentry/*`.
- [ ] 1.2 `npm run lint` stays green (both new file and edited `astro.config.mjs` must pass eslint).
- [ ] 1.3 `npm run build` succeeds — Astro build completes, adapter emits `dist/_worker.js/`, no TypeScript error on `sentry.server.config.ts`.
- [ ] 1.4 `npx wrangler deploy --dry-run --outdir=.wrangler-dryrun` succeeds — proves `main: "./sentry.server.config.ts"` resolves and bundles.
- [ ] 1.5 With no `SENTRY_DSN` in env, running `npm run build` and then invoking the bundled worker (e.g., `wrangler dev`) does not emit any Sentry network traffic (no-op mode).

#### Manual

- [ ] 1.6 Verify by reading `dist/_worker.js/index.js` (or the wrangler dry-run output) that `Sentry.withSentry` and `@sentry/cloudflare` are present in the bundle.
- [ ] 1.7 Verify by inspecting the browser bundle after `npm run build` that no `Sentry.init` runs client-side with a real DSN (should be no-op since `sentry({...})` was registered without a `dsn`).
- [ ] 1.8 `.env.example` documents `SENTRY_DSN` with the leave-empty-for-no-op note.

## Phase 2: Manual smoke against a real Sentry project

### Overview

Prove the wiring works end-to-end against a real Sentry Developer-plan project. No code changes — this phase is provisioning + verification + runbook capture.

### Steps

1. Create a Sentry organization + project (platform: **JavaScript → Cloudflare Workers**) at [sentry.io](https://sentry.io). Free Developer plan is enough (5000 errors/mo, 30-day retention).
2. Copy the project DSN from Settings → Client Keys (DSN).
3. Drop the DSN into `.dev.vars` locally: `SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>`.
4. `npm run build && npx wrangler dev` — visit any page, deliberately trigger:
   - a thrown error from an API route (e.g., temporary `throw new Error("sentry smoke test")` in [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts) `GET` handler), and
   - a `console.warn("sentry smoke: warn path")` from the same handler.
5. Confirm both events land in the Sentry dashboard within ~1 minute. Revert the temporary `throw` and `console.warn`.
6. For production: `npx wrangler secret put SENTRY_DSN` and paste the same DSN. Re-deploy with `npm run deploy`. Repeat the trigger from the deployed URL once to prove production wiring; then remove any temporary trigger code.
7. Write a short runbook at `context/changes/sentry-monitoring/runbook.md` documenting steps 1–6 for future reference (archived with the change).

### Success Criteria

#### Manual

- [ ] 2.1 Sentry project created, DSN captured.
- [ ] 2.2 Local `wrangler dev` with DSN in `.dev.vars` produces both a thrown-error issue AND a captured `console.warn` issue in the Sentry dashboard.
- [ ] 2.3 `npx wrangler secret put SENTRY_DSN` sets the production secret; `npx wrangler deploy` succeeds.
- [ ] 2.4 Production deploy produces a real Sentry issue when triggered once, then the trigger code is fully reverted.
- [ ] 2.5 `context/changes/sentry-monitoring/runbook.md` captures the provisioning steps for the archive.

## Open Risks & Assumptions

- **Assumption**: `@sentry/astro` 10.44.0 auto-detects `@astrojs/cloudflare` 13.5.0 without extra config. If the peer-dep matrix says otherwise, we may need to pin a slightly newer minor. Verified against [Sentry issue #19762](https://github.com/getsentry/sentry-javascript/issues/19762).
- **Assumption**: `wrangler` compiles TypeScript entry points via esbuild automatically. This is true for `wrangler` 3.x + and `wrangler.jsonc` config format. If not, we fall back to a `.mjs` wrapper.
- **Risk**: `captureConsoleIntegration({ levels: ["warn", "error"] })` shares the 5000-events/mo budget. If any hot path in the app spams `console.warn`, we burn the budget in hours. **Mitigation**: grep the current codebase for `console.warn` / `console.error` before shipping — if there are noisy paths, either quiet them or narrow the levels array before the first deploy.
- **Risk**: `@sentry/cloudflare` bundle size adds to the Workers 3MB compressed limit. Sentry SDK is not huge (~50KB gzipped) but combined with existing deps it's worth watching after `npm run build`. **Mitigation**: `wrangler deploy --dry-run` reports the bundle size; if it approaches the limit, drop the `sentry()` Astro integration (client bundle) since we're not using client-side capture.

## References

- User-provided setup guidance (this change's originating brief in [change.md](./change.md)).
- [Sentry issue #19762](https://github.com/getsentry/sentry-javascript/issues/19762) — Astro 6 + Cloudflare adapter 13+ support (fixed in 10.44.0).
- [Sentry issue #19753](https://github.com/getsentry/sentry-javascript/issues/19753) — pure client-side Astro 6 (not our path, tracked in case that changes).
- [Sentry pricing](https://sentry.io/pricing/) — Developer plan limits.
- [AGENTS.md](../../../AGENTS.md) — env secret conventions.
- [context/foundation/lessons.md](../../foundation/lessons.md) — no relevant rules for this change (no user-scoped tables, no scope-discipline hazards, no E2E specs).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Install packages, custom entry point, env plumbing

#### Automated

- [x] 1.1 `npm install` resolves clean, no peer-dep warnings from `@sentry/*`.
- [x] 1.2 `npm run lint` stays green.
- [x] 1.3 `npm run build` succeeds.
- [x] 1.4 `npx wrangler deploy --dry-run --outdir=.wrangler-dryrun` succeeds.
- [x] 1.5 With no `SENTRY_DSN`, no Sentry network traffic on cold-start.

#### Manual

- [x] 1.6 `Sentry.withSentry` and `@sentry/cloudflare` present in the built Workers bundle.
- [x] 1.7 Client bundle contains no active `Sentry.init` (no `PUBLIC_SENTRY_DSN`).
- [x] 1.8 `.env.example` documents `SENTRY_DSN` with the leave-empty-for-no-op note.

### Phase 2: Manual smoke against a real Sentry project

#### Manual

- [x] 2.1 Sentry project created, DSN captured.
- [x] 2.2 Local `wrangler dev` produces both thrown-error AND `console.warn` issues in the dashboard.
- [x] 2.3 `npx wrangler secret put SENTRY_DSN` sets production secret; `npx wrangler deploy` succeeds.
- [x] 2.4 Production deploy produces a real issue when triggered once, then trigger code is fully reverted.
- [x] 2.5 `runbook.md` captures the provisioning steps.
