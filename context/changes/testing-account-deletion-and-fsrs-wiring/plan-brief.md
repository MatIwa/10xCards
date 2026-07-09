# Account deletion completeness + FSRS wiring — Plan Brief

> Full plan: [context/changes/testing-account-deletion-and-fsrs-wiring/plan.md](./plan.md)

## What & Why

Lock the two Rollout Phase 3 risks from [test-plan.md §3](../../foundation/test-plan.md) as durable regression tests: account deletion completeness (Risk #5) and FSRS wiring passthrough correctness (Risk #6). Both are High-impact / Medium-likelihood — the deletion path certifies "complete erasure" and a wrong FSRS write silently corrupts a user's review schedule. This closes rollout phase 3; phase 4 (CI enforcement) can proceed after.

## Starting Point

- `deleteAccount` in [src/lib/services/account.service.ts](../../../src/lib/services/account.service.ts) hard-codes `.from("flashcards")` twice (pre-count + orphan-check); the `// TABLES:` marker comment above the check points at the [lessons.md](../../foundation/lessons.md) extensibility rule but nothing enforces it.
- FSRS wiring in [src/lib/services/review.service.ts](../../../src/lib/services/review.service.ts) is untested; `gradeCard` calls `scheduler.next(rehydrate(row), new Date(), rating)` and persists `serialize(returned)` scoped to `id + user_id`.
- Only one user-scoped table exists today (`public.flashcards`, cascade already in place per [supabase/migrations/20260531120000_create_flashcards.sql#L13](../../../supabase/migrations/20260531120000_create_flashcards.sql#L13)).
- Phase-2 harness is ready: `createIntegrationUser`, `invokeApiRoute`, `readFlashcardById`, `signInUser`; two-user pattern documented in test-plan cookbook §6.2. Phase 2 did NOT cover review sub-routes for RLS.

## Desired End State

`npm run test:unit` proves the wiring contracts (FSRS passthrough for 4 ratings + deletion partial-failure branches + a roster-equality guard). `npm run test:integration` proves end-to-end behavior over local Supabase (deletion happy path + FSRS round-trip + review-surface RLS gap-close). Test-plan cookbook §6.4 and §6.5 are filled in with concrete recipes so the next contributor adding a user-scoped table or FSRS-adjacent function has the pattern to copy without re-asking questions.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| FSRS oracle | Stub `ts-fsrs` module; assert `scheduler.next` call + persisted row deep-equals `serialize(<stub-return>)` | The oracle is the *wiring* (which card, which state, which write, which user), not the library's math — matches [test-plan §2 Risk #6](../../foundation/test-plan.md) anti-pattern column | Plan question `FSRS oracle` |
| FSRS scope | Unit wiring + one round-trip integration + review-surface RLS coverage (grade foreign card 404, queue actor-only) | Closes Phase 2's review-sub-route RLS gap at ~2 extra assertions on the same harness | Plan question `FSRS scope` |
| Deletion scope | Integration happy path + hermetic partial-failure branches + structural extensibility guard | Cheapest-signal-that-catches: happy path proves today's contract; hermetic covers partial failures real infra can't trigger; guard makes "added a table, forgot to extend the service" fail at edit time | Plan question `Deletion scope` |
| Deletion failure layer | Hermetic (stubbed `SupabaseClient`) for the two branches that real infra cannot trigger (`deleteUser` errored, orphan-check finds rows) | FK cascade makes both branches unreachable via real Supabase — matches test-plan Risk #5 layer guidance ("hermetic (stub client) — partial failures that real infra cannot trigger easily") | Plan question `Auth failure` |
| Extensibility guard | Extract `USER_SCOPED_TABLES` const in the service; test asserts it equals a hand-maintained roster in the unit file | Refactor-safe (no source parsing); the const doubles as internal documentation for the extensibility rule | Plan question `Table guard` |
| File layout | Colocated unit (`src/lib/services/*.test.ts`) + risk-folder + colocated integration | Every test lives next to (or in a risk folder next to) the code it protects; matches test-plan cookbook §6.1/§6.2 conventions | Plan question `File layout` |
| Preview scope | Unit `previewRatings` only; skip queue-endpoint response shape | Preview shape is closer to a Risk #1 concern; RLS on queue is covered via a shape-agnostic actor-only assertion | Plan question `Preview scope` |
| Priority | Both risks together in one plan (four phases inside) | Matches test-plan §3 "Phase 3 covers Risks #5 and #6" framing | Plan question `Priority` |

## Scope

**In scope:**
- Extract `USER_SCOPED_TABLES` const in `account.service.ts` (small productive refactor, zero behavior change).
- Unit test for `account.service.ts`: 4 hermetic partial-failure branches + 1 structural roster-equality guard.
- Integration test for `POST /api/account/delete`: happy path (303 + audit log + zero rows across every user-scoped table) + validation branch + unauth branch.
- Unit test for `review.service.ts`: `rehydrate`/`serialize` identity, `previewRatings` wiring for all 4 ratings, `gradeCard` wiring for all 4 ratings, not-found guard, upstream-error passthrough — via stubbed `ts-fsrs` module.
- Integration test for `POST /api/flashcards/[id]/review` + `GET /api/flashcards/review/queue`: grade round-trip, practice short-circuit pin, grade-foreign-card 404 with no side effect, unauth 401, queue actor-only, queue middleware unauth.
- Fill test-plan cookbook §6.4 (new user-scoped table recipe) and §6.5 (FSRS wiring recipe) + §6.6 phase note.

**Out of scope:**
- Risk #7 (server-side input validation) — separate change folder `testing-generate-privacy-and-input/`.
- Risk #1 review-queue preview-shape contract test — closer to schema-drift than Risk #6 wiring; opens a follow-up if surfaced.
- Any new ESLint rule (Phase 2's admin-client guard already covers review sub-routes transitively).
- Any change to `deleteAccount`'s return-shape or the endpoint's audit log format.
- Any dynamic `information_schema` / `pg_catalog` guard (rejected — slower feedback, live-DB coupling).
- CI wiring — Phase 4 of the rollout, not this change.
- Test-plan §3 Phase 3 status flip (orchestrator's job when the change closes).

## Architecture / Approach

Four phases in strict dependency order:

- **Phase 1** — refactor `account.service.ts` to loop the orphan-check over an exported `USER_SCOPED_TABLES` const; behavior byte-identical.
- **Phase 2** — Risk #5 top-to-bottom: integration happy path (real Supabase) + hermetic partial-failure unit tests + structural roster-equality guard.
- **Phase 3** — Risk #6 top-to-bottom: `vi.mock("ts-fsrs")` unit tests over all four ratings + one integration round-trip + review-surface RLS (foreign-card 404, queue actor-only, middleware unauth).
- **Phase 4** — cookbook sync: fill test-plan §6.4 + §6.5 + append §6.6 phase note.

Test files land colocated with source under the two Vitest project globs (`src/**/*.test.ts` for unit, `src/**/*.integration.test.{ts,tsx}` + `test/**/*.integration.test.{ts,tsx}` for integration). The one integration file for deletion lives in `test/account-deletion/` (mirrors Phase 2's `test/rls/` shape).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Extract `USER_SCOPED_TABLES` | Const + orphan-check loop; behavior identical | Refactor accidentally changes audit-log flashcard-count semantics |
| 2. Risk #5 tests | 3 integration + 5 unit test cases; the extensibility guard | Happy-path test cleanup deletes the auth user twice (once via endpoint, once via `afterEach`) — must guard `afterEach` |
| 3. Risk #6 tests | 12 unit + 6 integration cases; review-surface RLS gap closed | `vi.mock("ts-fsrs")` interferes with `Rating` enum imports if `vi.importActual` is skipped |
| 4. Cookbook sync | Test-plan §6.4 + §6.5 filled; §6.6 note appended | None material |

**Prerequisites:** Local Supabase running (`npx supabase start`) with `TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY` exported. Phases 1 + 2 of the test-plan rollout already landed.
**Estimated effort:** ~2-3 focused sessions across 4 phases.

## Open Risks & Assumptions

- **Assumption: `vi.mock("ts-fsrs")` with `await vi.importActual` preserves the `Rating` enum surface.** Standard Vitest pattern; if it breaks, fallback is to re-declare `Rating` as `{ Again: 1, Hard: 2, Good: 3, Easy: 4 }` in the mock factory (values must match ts-fsrs's enum — verify against `node_modules/ts-fsrs/dist/index.d.ts`).
- **Assumption: `readFlashcardById` in [test/helpers/db.ts](../../../test/helpers/db.ts) is sufficient for Phase 3 integration post-checks.** Queue actor-only test may want a `readFlashcardsForUser(userId)` helper; add only if `readFlashcards` (already present) is not close enough.
- **Assumption: real Supabase's FK cascade makes the "orphan-check finds rows" branch unreachable end-to-end.** Manually verified against the current schema — the only user-scoped table is `flashcards` and its FK has `on delete cascade`. If a future user-scoped table adds without cascade, the integration test will start failing on that branch, which is exactly the alarm we want.
- **Assumption: the `practice: true` short-circuit in [src/pages/api/flashcards/[id]/review.ts](../../../src/pages/api/flashcards/[id]/review.ts) is intentional product behavior**, not a legacy artifact. The regression-pin test locks it in; if product intent changes, delete the test with the endpoint edit in the same PR.

## Success Criteria (Summary)

- Account deletion completeness on `flashcards` is provably locked; adding a new user-scoped table without extending the service fails `npm run test:unit -- account.service` before the code runs.
- FSRS wiring passthrough is provably locked; any silent drift in the call to `scheduler.next` or the persisted state fails a unit or integration test.
- Test-plan cookbook §6.4 + §6.5 are filled with recipes concrete enough that the next contributor does not need to re-read the questioning round.
