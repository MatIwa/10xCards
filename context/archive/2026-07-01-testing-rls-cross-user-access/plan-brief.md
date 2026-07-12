# Cross-user access tests for flashcards CRUD (Risk #3) — Plan Brief

> Full plan: [context/changes/testing-rls-cross-user-access/plan.md](./plan.md)
> Research: [context/changes/testing-rls-cross-user-access/research.md](./research.md)

## What & Why

Lock the "user A cannot read, spoof, update, or delete user B's flashcards" contract from PRD §Access Control as durable integration tests over the four CRUD endpoints (`GET/POST /api/flashcards`, `PUT/DELETE /api/flashcards/[id]`), and pin the "no admin client on this surface" invariant with an ESLint rule that fails at edit time. This is Rollout Phase 2 of the test plan ([context/foundation/test-plan.md §3](../../foundation/test-plan.md)), covering **Risk #3 in isolation** — Risks #4 and #7 get their own change folders per the scope-freeze in [change.md](./change.md).

## Starting Point

The three-layer defense (middleware pre-gate, cookie-scoped anon client, `.eq("user_id", userId)` + RLS policies) is already in place; the `user_id` FK cascades and the four per-command RLS policies compare `auth.uid() = user_id` on `public.flashcards`. Cross-user isolation has never been automated — [context/archive/2026-05-31-manual-flashcard-crud/plan.md:32](../../archive/2026-05-31-manual-flashcard-crud/plan.md#L32) explicitly deferred it. The Phase 1 test harness seeds one user only and inlines the `APIContext` fabrication inside `test/helpers/api-route-fetch-stub.ts` for a single endpoint.

## Desired End State

`npm run test:integration` runs `test/rls/flashcards-cross-user.integration.test.ts` (~8 assertions from the [research.md §6](./research.md) oracle) against local Supabase and passes. `npm run lint` fails if any file under `src/pages/api/flashcards/**`, `src/pages/api/dashboard/**`, `src/lib/services/flashcard.service.ts`, or `src/lib/services/review.service.ts` imports `@/lib/supabase-admin`. Test-plan cookbook §6.2 documents the two-user pattern for the next contributor.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Handler invocation | Direct import of exported `GET`/`POST`/`PUT`/`DELETE` + fabricated `APIContext` | Astro dev server is overkill for a route-boundary test and violates test-plan §7 "infra tuning minimal"; middleware asserted separately via `onRequest` import | Plan question `HandlerInvoke` + [research OQ-1](./research.md) |
| Cookie injection | Sign in via real anon-client `signInWithPassword`, mirror `sb-<ref>-auth-token` into request `Cookie` header | Handlers stay untouched; RLS sees real `auth.uid()`; reuses the format already pinned in [supabase-session.ts:16-45](../../../test/helpers/supabase-session.ts#L16-L45) | Plan question `CookieInjection` + [research OQ-2](./research.md) |
| Second-user pattern | Per-test factory `createIntegrationUser()` with random email suffix | Hermetic per test; scales to N > 2 for future Risks #5/#7; small admin-client roundtrip cost acceptable on local DB | Plan question `SecondUser` |
| File layout | One consolidated file `test/rls/flashcards-cross-user.integration.test.ts` | Risk-shaped organization matches [test-plan.md §6.2](../../foundation/test-plan.md) and reads top-to-bottom like the oracle table | Plan question `FileLayout` |
| Structural guard | ESLint `no-restricted-imports` scoped to the four flashcards/dashboard paths | Edit-time regression net at zero runtime cost; scales the same way to future Risks #4/#7 | Plan question `StructuralGuard` + [research OQ-3](./research.md) |
| Assertion scope | Full [research.md §6](./research.md) oracle + OQ-4 (POST body spoof) + OQ-5 (PUT `updated_at` non-change pin) | Each addition catches a distinct regression class (Zod passthrough drift, side-effects on rejected writes); cheap to include | Plan question `AssertionScope` + [research OQ-4, OQ-5](./research.md) |
| Hermetic stubs | Not used | Every Risk #3 failure mode is reproducible against real local Supabase; a stub of the Supabase client would give false safety by lying about RLS | Test-plan §2 Risk #3 anti-patterns |

## Scope

**In scope:**
- Two-user integration test file for flashcards CRUD (Risk #3), ~8 cases mapping to [research.md §6](./research.md).
- Harness generalization: `signInUser(credentials)`, `createIntegrationUser()`, `invokeApiRoute()`, `readFlashcardById()`.
- Smoke test file `test/helpers/harness.smoke.integration.test.ts` proving the new helpers work.
- ESLint `no-restricted-imports` rule scoped to four paths.
- Cookbook §6.2 append (two-user pattern) + §6.6 phase note.

**Out of scope:**
- Risks #4 (source-text non-retention) and #7 (server-side input validation) — separate change folders per [change.md](./change.md) scope-freeze.
- Review, generation, and account endpoints.
- FSRS-specific RLS testing (FSRS columns inherit the same policies; separate concern goes to Rollout Phase 3).
- Product-code refactors (handlers keep re-creating the anon client from headers/cookies).
- CI wiring (`.github/workflows/ci.yml` untouched — Rollout Phase 4 territory).
- Flipping the [test-plan.md §3 Phase 2](../../foundation/test-plan.md) status row (orchestrator's job).

## Architecture / Approach

Four phases, ordered by dependency. Phase 1 is **environment setup** — nothing about Risk #3 gets asserted yet; three existing single-user helpers get lifted into N-user shape and each is proven with one smoke `it()`. Phase 2 is the risk-anchored integration test — one file with ~8 assertions mapping directly to the oracle table, plus a direct `onRequest` test for the middleware unauth path. Phase 3 is the ESLint rule (edit-time, zero runtime cost) verified with a temporary bad-import experiment. Phase 4 syncs the cookbook. The test file imports Astro handlers directly and calls them with a fabricated `APIContext` carrying real Supabase session cookies from `signInWithPassword`; assertions read both the HTTP response and the DB state (via admin-client post-check) so a rejected write is proven to have zero side effects.

## Phases at a Glance

| Phase | What it delivers | Behavior asserted / regression caught | Key risk |
|---|---|---|---|
| 1. Two-user harness + APIContext helper | `signInUser`, `createIntegrationUser`, `invokeApiRoute`, `readFlashcardById`, one smoke test per helper | Nothing (pure infra) | Cookie format drift in `@supabase/ssr`; existing Phase 1 tests must keep passing via re-export |
| 2. RLS integration tests | `test/rls/flashcards-cross-user.integration.test.ts` — ~8 cases | User A cannot observe or mutate user B's flashcards; POST drops `user_id` from body; PUT/DELETE against foreign row returns 404 with no side effect; unauth returns 401 from middleware | Test flake from parallel factory-user creation; RLS-policy misinterpretation |
| 3. Structural guard | ESLint `no-restricted-imports` in [eslint.config.js](../../../eslint.config.js) | Any future edit importing `@/lib/supabase-admin` into the flashcards/dashboard surface fails `npm run lint` | Overly broad glob accidentally catching `account/delete.ts` |
| 4. Cookbook sync | Append to [test-plan.md §6.2](../../foundation/test-plan.md) + §6.6 note | (documentation only) | None material |

**Prerequisites:** Local Supabase running (`npx supabase start`); `TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY` exported; Phase 1 of the test-plan rollout landed (already done — commit `f58ca76`).
**Estimated effort:** ~2 focused sessions across 4 phases.

## Open Risks & Assumptions

- **`@supabase/ssr` cookie format** is pinned by observation, not spec — same trade already accepted in Rollout Phase 1. Centralized in [test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts); one file to update if the shape changes.
- **Per-test factory users leak on test crash.** Local DB, disposable — accepted; `supabase db reset` between test runs is the escape hatch. Not a production concern.
- **Assumption: `updated_at` is a DB trigger and does not fire when 0 rows match.** Verified by reading [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) — the trigger runs `for each row` on UPDATE, and PostgREST issues no UPDATE when `.eq("user_id", userId)` matches zero rows. Case (4) in Phase 2 depends on this; if wrong, the assertion must move to a tolerance.
- **Assumption: the ESLint `no-restricted-imports` rule with file-scoped overrides works with the flat config in [eslint.config.js](../../../eslint.config.js).** If not, fallback to a Vitest grep-style structural test (rejected in `StructuralGuard` question but documented as a retreat path).

## Success Criteria (Summary)

- Cross-user isolation on flashcards CRUD is provably locked: `npm run test:integration` passes today and fails immediately if any of the four RLS policies weakens.
- Any future edit adding an admin-client import to the flashcards or dashboard surface fails `npm run lint` before the code runs.
- The two-user harness pattern is documented in test-plan.md §6.2 well enough for the Risks #4 and #7 change folders to reuse it without asking questions.
