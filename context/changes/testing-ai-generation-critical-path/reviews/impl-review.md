<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bootstrap Vitest + AI generation critical-path tests

- **Plan**: [context/changes/testing-ai-generation-critical-path/plan.md](../plan.md)
- **Scope**: All 3 phases (fully implemented)
- **Date**: 2026-07-01
- **Verdict**: NEEDS ATTENTION → TRIAGED (2026-07-01)
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned production code change in supabase-admin.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/lib/supabase-admin.ts:4-11 (commit b13995c, phase 2)
- **Detail**: Plan's Migration Notes state: "This change is additive: new files, three new npm scripts, no changes to existing production code." The Phase 2 commit modified `src/lib/supabase-admin.ts` to add a `getServerEnvValue()` helper guarding against non-string / empty env values, changing runtime behavior of the account-deletion admin client. The change is small and defensive (accommodates the test env mock returning `undefined`), but (a) violates the plan's explicit no-prod-changes promise, and (b) is one-sided — `src/lib/supabase.ts` still uses the old `if (!SUPABASE_URL) return null` pattern with no similar guard.
- **Fix A ⭐ Recommended**: Document as intentional test-driven hardening and mirror it in `src/lib/supabase.ts`
  - Strength: Keeps the improvement, closes the consistency gap, adds a plan addendum so future reviewers know why. Cost is a tiny mirror-edit plus a 3-line plan note.
  - Tradeoff: Widens the change; more prod code touched by what was framed as a pure-test change.
  - Confidence: HIGH — the pattern is trivial and both files handle env identically.
  - Blind spot: Haven't verified whether any caller relies on passing empty strings intentionally (unlikely).
- **Fix B**: Revert `supabase-admin.ts` and fix the test env instead
  - Strength: Restores the plan's promise; unit test can override the mock inline (already the `vi.hoisted` pattern in `ai-generation.service.test.ts`).
  - Tradeoff: Loses a small production robustness win.
  - Confidence: MEDIUM — need to verify `delete.ts` still handles the mock cleanly under test.
  - Blind spot: Whether integration tests transitively rely on the new behavior.
- **Decision**: FIXED via Fix A (2026-07-01) — mirrored `getServerEnvValue` into `src/lib/supabase.ts`; documented in `plan.md` §Migration Notes.

### F2 — Synthetic APIContext.cookies stub only implements set()

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/helpers/api-route-fetch-stub.ts:16-22
- **Detail**: `createCookieSink()` returns `{ set() { return undefined; } }` cast to `APIContext["cookies"]`. Real Astro cookies expose `get`, `getAll`, `has`, `delete`, `set`, `setAll`. This only works today because `src/lib/supabase.ts` reads cookies from `request.headers.get("Cookie")` and writes via `cookies.set` inside a `setAll` callback. Any future API route that calls `cookies.get()`/`getAll()` before creating the supabase client will silently receive `undefined` or throw on the cast. Because this is meant to be the reference integration test — new contributors will copy this stub — the fragility will propagate.
- **Fix**: Implement the full read/write surface, backing reads with the session cookie header and writes as no-ops:
  ```ts
  function createCookieSink(sessionCookie: string): APIContext["cookies"] {
    const parsed = parseCookieHeader(sessionCookie);
    return {
      get: (name) => parsed.find((c) => c.name === name),
      getAll: () => parsed,
      has: (name) => parsed.some((c) => c.name === name),
      set: () => {},
      delete: () => {},
      merge: () => {},
      headers: () => [],
    } as unknown as APIContext["cookies"];
  }
  ```
  Add a one-line note in cookbook §6.6 that the stub mirrors the header cookie so any route is safe to invoke.
- **Decision**: FIXED (2026-07-01) — `createCookieSink(sessionCookie)` now implements the full `APIContext["cookies"]` surface; §6.6 note added.

### F3 — Duplicated env-mocking layer (module alias + vi.mock)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts:5-12 + test/setup/env.ts + test/setup/astro-env-server.ts
- **Detail**: Plan §"astro:env/server module resolution" specified a single `vi.mock()` in setupFiles. Actual implementation ships both: a `resolve.alias` in `vitest.config.ts` pointing at `test/setup/astro-env-server.ts` (module-level exports) AND a `vi.mock` in `test/setup/env.ts`. Both return the same values, so today it's harmless — but two source-of-truth files for the same fixture is a latent inconsistency (adding a new env key requires editing three files).
- **Fix**: Pick one. Recommend keeping the `resolve.alias` (more robust; resolves at config time) and deleting `env.ts` from `setupFiles`. Move the `TEST_*` env-var comment into `astro-env-server.ts`.
- **Decision**: FIXED (2026-07-01) — deleted `test/setup/env.ts`; alias in `vitest.config.ts` → `test/setup/astro-env-server.ts` is the single source of truth. `plan.md` §Migration Notes records the removal.

### F4 — Env-mock style diverges across the two reference tests

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/setup/env.ts:4-9 vs src/lib/services/ai-generation.service.test.ts:3-11
- **Detail**: `test/setup/env.ts` uses a static top-level `vi.mock` with literal values. `ai-generation.service.test.ts` uses `vi.hoisted() + getters` so a test can mutate env keys per case (needed for the missing-API-key test). Both are valid Vitest patterns, but the reference tests should demonstrate ONE canonical pattern for cookbook §6.1 consumers to copy — right now a contributor picking a random file gets a random pattern.
- **Fix**: Add a 2-line note to cookbook §6.1: "Use `vi.hoisted` + getters when a test needs to mutate env values; otherwise the global setupFile is enough."
- **Decision**: FIXED (2026-07-01) — added an "Env mocks" bullet to test-plan §6.1 documenting alias-default vs `vi.hoisted`-override.

### F5 — Single shared TEST_USER_ID across integration tests

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: test/setup/global-integration.ts:33-64
- **Detail**: `globalSetup` seeds one user and stores the id on `process.env.TEST_SUPABASE_USER_ID`. Vitest defaults to file-parallel execution; today only one integration test file exists so there's no collision. But test-plan §3 Phase 2 (Risk #3 cross-user RLS) will need two users, and Phase 3 will add more integration files. If a future file forgets `resetFlashcards()` in `beforeEach` — or two files run in parallel and truncate each other's rows — the flakiness will be blamed on Supabase, not on the harness. Intentionally deferred by the current plan; noting so Phase 2 plan-review catches it.
- **Fix**: Two options for Phase 2 (not this phase):
  - Add a per-file suffix helper to `test/helpers/integration-user.ts` (`createTestUser(suffix)` seeds and returns a unique user); or
  - Keep the single user but disable file-parallelism via `vitest.config.ts` `poolOptions.threads.singleThread` for the integration project.
- **Decision**: DEFERRED (2026-07-01) — recorded in `follow-ups/review-fixes.md` for `/10x-plan` on test-plan §3 Phase 2 to decide.

## Notes

- Plan Adherence: 12/13 planned artifacts MATCH; the env-mocking duplication (F3) is the only structural drift.
- All Progress checkboxes are `[x]` across phases 1–3.
- Unit suite runs green (13 tests, ~540 ms). Lint runs green.
- Integration suite is gated on local Supabase per plan §5; cannot verify in this review environment. Trust the `[x]` on 3.1–3.9 given code inspection matches spec.
- Positive: `supabase-admin.ts` is correctly walled off — only `src/pages/api/account/delete.ts` imports it. Not called from any flashcard path.
- Positive: `test/helpers/db.ts` uses per-user cleanup instead of full db reset — matches the plan's efficiency and multi-user future-proofing goals.
- False alarms discarded from sub-agent reports:
  - "CI doesn't run tests" — explicit "Not Doing" in the plan; scope guardrail respected.
  - "base64- cookie prefix is non-standard" — that IS the `@supabase/ssr` format for encoded session cookies.
