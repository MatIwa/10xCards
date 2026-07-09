# Account deletion completeness + FSRS wiring — Test Rollout Phase 3 Plan

## Overview

Lock the two Rollout Phase 3 risks from [context/foundation/test-plan.md §3](../../foundation/test-plan.md) as durable regression tests:

- **Risk #5** — Account deletion must produce zero orphan rows across every user-scoped table, forever. Since exactly one such table exists today (`public.flashcards`), the load-bearing regression is the **extensibility contract** from [context/foundation/lessons.md](../../foundation/lessons.md): "any new user-scoped table MUST both cascade on `auth.users` delete AND be added to the orphan-check." A structural guard makes "forgot to extend the service" fail at edit time, not at runtime.
- **Risk #6** — Given a card with FSRS state X and a recall rating Y, `gradeCard` must call `ts-fsrs.scheduler.next(rehydrate(row), <Date>, Y)` and persist `serialize(returned)` unmodified onto that card's row scoped to `id + user_id`. The oracle is the **call and passthrough**, never the library's math.

Both risks ship in one change; four phases inside.

## Current State Analysis

- **Deletion surface** ([src/lib/services/account.service.ts](../../../src/lib/services/account.service.ts)): `deleteAccount(adminClient, userId)` runs three admin-client operations — pre-count `flashcards`, `auth.admin.deleteUser`, orphan-check select on `flashcards`. Hard-codes `.from("flashcards")` in two places. Carries the required `// TABLES:` marker comment ([lines 22-25](../../../src/lib/services/account.service.ts#L22)) pointing at the lessons rule. Returns `{ data: <pre-count>, error: string | null }`.
- **Deletion endpoint** ([src/pages/api/account/delete.ts](../../../src/pages/api/account/delete.ts)): builds anon + admin clients, validates `deleteAccountSchema` (`{ confirmation: "DELETE" }`), calls service, emits `{ event: "account_deleted", user_id, flashcards_deleted_count, timestamp }` JSON log on success or `account_delete_failed` on error, signs the user out (`scope: "local"`, errors swallowed), 303-redirects to `/auth/signin?deleted=1`.
- **FSRS wiring** ([src/lib/services/review.service.ts](../../../src/lib/services/review.service.ts)): `rehydrate(row)` and `serialize(card)` are pure functions over the FSRS column set. `previewRatings(row, now)` calls `scheduler.repeat(rehydrate(row), now)` and returns `{ again, hard, good, easy }` due-dates picked out of the scheduler return. `gradeCard(supabase, id, userId, rating)` reads via `.eq("id", id).eq("user_id", userId).maybeSingle()`, calls `scheduler.next(rehydrate(existing), new Date(), rating as Grade)`, writes via `.update(serialize(card)).eq("id", id).eq("user_id", userId)`. Scheduler is constructed once at module top with `{ request_retention: 0.9, enable_fuzz: true, enable_short_term: true }`.
- **Review endpoints**: `POST /api/flashcards/[id]/review` ([src/pages/api/flashcards/[id]/review.ts](../../../src/pages/api/flashcards/[id]/review.ts)) short-circuits with `{ data: null, skipped: true }` when `practice: true`; otherwise calls `gradeCard`. Maps `error === "Flashcard not found"` to 404. `GET /api/flashcards/review/queue` ([src/pages/api/flashcards/review/queue.ts](../../../src/pages/api/flashcards/review/queue.ts)) resolves `mode` (`"due"`|`"practice"`), calls `listDueCards` or `listPracticeCards`, maps each result through `previewRatings`.
- **Only user-scoped table today** ([supabase/migrations/20260531120000_create_flashcards.sql#L13](../../../supabase/migrations/20260531120000_create_flashcards.sql#L13)): `user_id uuid not null references auth.users(id) on delete cascade`. The FSRS migration ([20260601120000_flashcards_fsrs.sql](../../../supabase/migrations/20260601120000_flashcards_fsrs.sql)) does not touch the FK.
- **Test harness is Phase-2 ready**: `createIntegrationUser` ([test/helpers/integration-user.ts](../../../test/helpers/integration-user.ts)), `signInUser` ([test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts)), `invokeApiRoute` ([test/helpers/invoke-api-route.ts](../../../test/helpers/invoke-api-route.ts)), `readFlashcardById` / `resetFlashcards` ([test/helpers/db.ts](../../../test/helpers/db.ts)). Vitest workspace has `unit` and `integration` projects ([vitest.config.ts](../../../vitest.config.ts)); `integration` uses the jsdom env + `global-integration.ts` global setup.
- **ESLint admin-client guard** ([eslint.config.js#L71-L98](../../../eslint.config.js#L71)) already blocks `@/lib/supabase-admin` imports on `src/pages/api/flashcards/**`, `src/pages/api/dashboard/**`, `src/lib/services/flashcard.service.ts`, `src/lib/services/review.service.ts`. Review endpoints under `src/pages/api/flashcards/review/**` and `src/pages/api/flashcards/[id]/review.ts` are already covered transitively.
- **No test file yet** for `account.service.ts` or `review.service.ts`. Phase 2 RLS coverage ([test/rls/flashcards-cross-user.integration.test.ts](../../../test/rls/flashcards-cross-user.integration.test.ts)) covered flashcards CRUD only; review sub-routes are untested at the boundary.

### Key Discoveries

- The `// TABLES:` marker in [account.service.ts#L22-L25](../../../src/lib/services/account.service.ts#L22) is intentional editorial infrastructure — pinning a `USER_SCOPED_TABLES` const near it lets the extensibility guard reference a single source of truth without regex-parsing source.
- `deleteAccount`'s pre-count is only over `flashcards` and is returned to the endpoint for the audit log. When the const grows past one entry, the "N flashcards deleted" audit shape must still work; the pre-count belongs on `flashcards` specifically (it's what the current audit log calls out), not summed across tables. Keep the pre-count read distinct from the orphan-check loop.
- Real Supabase FK cascade makes the "orphan-check finds rows after delete" branch unreachable through real infra — cascade fires atomically with the auth-user delete. This branch MUST be hermetic (stubbed admin client that returns a fake orphan row). Same reasoning applies to the `auth.admin.deleteUser` error branch. Matches [test-plan §2 Risk #5](../../foundation/test-plan.md) row "hermetic (stub client) — partial failures that real infra cannot trigger easily."
- Stubbing the scheduler is not the anti-pattern the test-plan warns about. The anti-pattern is *recomputing the library's math in the assertion*. Stubbing the scheduler at the module boundary lets us assert **the call** (`scheduler.next(rehydratedCard, aDate, rating)`) and **the passthrough** (row deep-equals `serialize(stub-returned-card)`) without depending on any specific FSRS output — the oracle stays the wiring, not the math.
- `review.service.ts` imports `fsrs` and constructs the scheduler at module load: `const scheduler = fsrs({...})`. Stubbing the scheduler requires `vi.mock("ts-fsrs")` with a factory that returns a `fsrs()` producing a spy-able `next`/`repeat` object. Follows the [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts) pattern of `vi.hoisted` + module mock at top of file.
- `POST /api/flashcards/[id]/review` short-circuits before `gradeCard` when the body includes `practice: true`. Tests that exercise the real grade path must omit `practice` (or set it explicitly `false`), and there should be one test that pins the `practice: true` skip contract too — it's an existing behavior that a Risk #6 refactor could accidentally erase.
- `readFlashcardById` in [test/helpers/db.ts](../../../test/helpers/db.ts) uses the service-role client, bypassing RLS — the correct helper for the integration post-checks. No new helper needed.
- The [testing-rls-cross-user-access plan-brief](../testing-rls-cross-user-access/plan-brief.md) explicitly deferred FSRS RLS coverage to Rollout Phase 3, matching the "review-surface RLS coverage" scope decision in this plan's questioning round.

## Desired End State

`npm run test:unit` runs three new unit test files (`review.service.test.ts`, `account.service.test.ts`) exercising:

- FSRS wiring passthrough for all four ratings (Again/Hard/Good/Easy) via stubbed `scheduler.next`.
- `previewRatings` calling `scheduler.repeat` and lifting all four rating dates from its return.
- `rehydrate` / `serialize` identity round-trip.
- The `USER_SCOPED_TABLES` roster used by `deleteAccount` equals the test-side roster (structural extensibility guard).
- Two hermetic partial-failure branches of `deleteAccount` (`auth.admin.deleteUser` errored → returns error; orphan-check reports rows → returns `"Verification failed: orphaned flashcards remain"`).

`npm run test:integration` runs two new integration files (`account-delete.integration.test.ts`, `review.service.integration.test.ts`) against local Supabase:

- Deleting an account with 3 seeded flashcards returns 303 to `/auth/signin?deleted=1`, `auth.users` has zero rows for that id, `public.flashcards` has zero rows for that id, and the deletion audit log line was emitted once.
- Grading a real card as user A round-trips through `POST /api/flashcards/[id]/review`: response 200 with the persisted state, DB row (read via admin client) reflects an FSRS state change.
- User A grading user B's card returns 404 with the target row unchanged.
- User A hitting `GET /api/flashcards/review/queue` returns zero user-B cards.
- `POST /api/flashcards/[id]/review` with `practice: true` returns `{ data: null, skipped: true }` and does not touch the row.

Test-plan cookbook §6.4 (new user-scoped table) and §6.5 (FSRS wiring pattern) are filled in with concrete references to the new test files. §6.6 gets a Phase 3 note capturing anything surprising the rollout taught. `npm run lint` continues to pass.

## What We're NOT Doing

- **No change to the `deleteAccount` return-shape contract** other than the internal const extraction (behavior identical, only source structure moves). The endpoint still receives `{ data: <pre-count>, error }` and its audit log stays byte-identical.
- **No dynamic `information_schema` / `pg_catalog` guard** — rejected in the questioning round. The const-roster equality is the extensibility check; live-DB catalog probing is slower and couples the guard to Supabase-being-up.
- **No coverage of Risk #7 (server-side input validation)** — separate change folder (`testing-generate-privacy-and-input/`), Rollout Phase 2 territory.
- **No changes to `deleteAccountSchema` / `gradeReviewSchema` themselves** — Zod-boundary drift is a Risk #7 concern.
- **No dedicated integration test for `GET /api/flashcards/review/queue` response shape** — preview-shape coverage is out of scope per the questioning round; queue is only touched to prove RLS.
- **No CI wiring change** — that is Rollout Phase 4 (`.github/workflows/ci.yml` still runs lint + build only; test gates flip on in Phase 4). This plan does not enable a `npm test` CI step.
- **No update to test-plan §3 Phase 3 status** — that is the orchestrator's job when the change closes.
- **No new ESLint rules** — Phase 2's admin-client guard is sufficient; nothing else in this change warrants an edit-time regression net beyond the const-roster test.
- **No refactor of `review.service.ts`** — the wiring is fine as-is; tests conform to the current shape (scheduler at module top, private inside the file). If a future refactor injects the scheduler for easier testing, that's a follow-up.
- **No FSRS math or configuration testing** (`request_retention: 0.9`, `enable_fuzz`, `enable_short_term`) — that's ts-fsrs's responsibility; changing those constants is not a Risk #6 regression.

## Implementation Approach

Four phases in strict dependency order. Phase 1 is a small productive refactor that Phase 2 depends on (the const is the guard's single source of truth). Phase 2 covers Risk #5 top-to-bottom (integration happy path + hermetic partial failures + structural guard). Phase 3 covers Risk #6 (unit wiring for all four ratings + one integration round-trip + review-surface RLS gap-close). Phase 4 syncs the cookbook so §6.4 and §6.5 are filled in for the next contributor.

## Critical Implementation Details

- **Stub scheduler at the `ts-fsrs` module boundary, not inside the service.** `vi.mock("ts-fsrs", () => ({...}))` at the top of `review.service.test.ts` replaces the module such that `import { fsrs, Rating } from "ts-fsrs"` yields a factory returning a spy-able `{ next, repeat }`. Preserve `Rating` as a real object (either re-export the real enum from the mock factory or import the constants and re-emit them) — tests use `Rating.Again`/etc. as inputs. Follows the [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts) `vi.hoisted` + module-mock precedent.
- **Timing of `scheduler.next(_, aDate, _)`.** The service calls `new Date()` inline. Tests should assert only that the second argument is a `Date` whose value is close to test-time (or use `vi.useFakeTimers()` and assert the exact instant). Choose fake timers — the pattern already exists elsewhere in the repo and avoids clock-flake.
- **Integration test cleanup on account deletion.** Deleting an account removes the auth user, so the standard `afterEach` reset must NOT try to `signIn` as the deleted user. Use `createIntegrationUser` per test (already random-suffixed) and skip the reset when the deletion succeeded — the cascade already wiped their rows. For failure-path integration tests, standard reset applies.
- **`practice: true` short-circuit.** One assertion pins this contract in the integration file: sending `{ rating: <any>, practice: true }` returns 200 with `{ data: null, skipped: true }` and the row is byte-identical after the call (read via admin client). This is a **regression pin** — a Risk #6 refactor could accidentally erase this behavior.

## Phase 1: Extract `USER_SCOPED_TABLES` in `account.service.ts`

### Overview

Introduce a single-source-of-truth const listing user-scoped table names, refactor the orphan-check loop over it, keep the pre-count read on `flashcards` for the audit log unchanged. Behavior is byte-identical after this phase.

### Changes Required

#### 1. `USER_SCOPED_TABLES` const + orphan-check loop

**File**: [src/lib/services/account.service.ts](../../../src/lib/services/account.service.ts)

**Intent**: Extract the hard-coded orphan-check table name into an exported const that both the service and the Phase 2 structural guard test can import. The `// TABLES:` marker comment is repositioned to sit immediately above the const declaration so it introduces the roster rather than the loop. The orphan-check loops over the const and returns the first-found orphan's table name in the error string so failures are actionable (e.g., `"Verification failed: orphaned rows in <table>"`).

**Contract**:

- Export `USER_SCOPED_TABLES = ["flashcards"] as const` at module top (below imports).
- `deleteAccount` still:
  - Returns `{ data: <pre-count>, error: string | null }` — same signature.
  - Runs the pre-count `.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", userId)` as-is (audit log needs `flashcards`-specific count).
  - Calls `adminClient.auth.admin.deleteUser(userId)` unchanged.
  - **Changed**: replaces the hardcoded orphan-check on `flashcards` with a `for (const table of USER_SCOPED_TABLES)` loop that runs `.from(table).select("id").eq("user_id", userId).limit(1)` per table; on the first table returning rows, returns `{ data: null, error: `Verification failed: orphaned rows in ${table}` }`; on a query error, returns `{ data: null, error: <supabase error message> }`.
- Move the `// TABLES:` marker comment to sit above `USER_SCOPED_TABLES` (verbatim wording from [lessons.md](../../foundation/lessons.md) — "any new table with user_id -> auth.users(id) MUST declare `on delete cascade` AND be added here"). The service becomes self-documenting for the extensibility rule.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- `npx supabase start` running; existing manual delete flow from the [archived plan](../../archive/2026-06-24-account-deletion-gdpr/plan.md#L299) still works end-to-end (sign up → create flashcards → `POST /api/account/delete` → 303 → auth row and flashcards row gone). This is a smoke check that the refactor did not change observable behavior.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Risk #5 tests — account deletion completeness

### Overview

Two test files land: an integration file proving the happy path over real Supabase, and a unit file covering the hermetic partial-failure branches plus the structural extensibility guard.

### Changes Required

#### 1. Integration test — happy path

**File**: `test/account-deletion/account-delete.integration.test.ts` (new)

**Intent**: Prove that a real end-to-end deletion request from an authenticated user removes the auth row and every user-scoped row, returns the correct redirect, and emits the audit log line exactly once. Read final DB state via the admin-client helper (RLS would hide surviving rows behind an authorization failure; admin-client bypasses so the assertion is honest).

**Contract**:

- Imports the `POST` handler from `@/pages/api/account/delete` and `USER_SCOPED_TABLES` from `@/lib/services/account.service`.
- Uses `createIntegrationUser({ emailPrefix: ... })` per test with a random suffix, signs the user in, and seeds 3 rows in `public.flashcards` via the service-role client.
- Spies on `console.log` (`vi.spyOn(console, "log")`) to capture the audit line; uses `vi.spyOn(console, "error")` for the failure test.
- Invokes the handler via `invokeApiRoute({ method: "POST", pathname: "/api/account/delete", session, body: { confirmation: "DELETE" }, handler: POST })`.
- Assertions:
  1. Response status is 303 and `Location` header ends with `/auth/signin?deleted=1`.
  2. The service-role client queries `auth.users` for the deleted `userId` and receives zero rows (`adminClient.auth.admin.getUserById(userId)` returns `data.user === null` or errors with `user_not_found`).
  3. For each `table` in `USER_SCOPED_TABLES`, a service-role `.from(table).select("id").eq("user_id", userId)` returns an empty array.
  4. `console.log` was called once with a JSON string whose parsed payload deep-equals `{ event: "account_deleted", user_id: <userId>, flashcards_deleted_count: 3, timestamp: <string> }` (the `timestamp` field is any ISO-8601 string).
- Additional assertion — validation branch: sending `{ confirmation: "delete" }` (lowercase) returns 400 with Zod issues and the auth row + flashcards remain.
- Additional assertion — unauth branch: invoking without a `session` returns 401 with `{ error: "Unauthorized" }`.
- `beforeEach` creates a fresh user; `afterEach` resets flashcards only for tests that did NOT delete the account (guard with a `deleted: boolean` flag set inside each test). No cleanup of `auth.users` for happy-path tests — the endpoint already deleted the user.

#### 2. Unit test — hermetic partial failures + structural guard

**File**: `src/lib/services/account.service.test.ts` (new)

**Intent**: Cover the two failure branches that real Supabase cannot reproduce (auth-delete error, orphan-check finds rows) using a stubbed `SupabaseClient`, plus assert the `USER_SCOPED_TABLES` roster equals the test-side hand-maintained roster so a new user-scoped table forces a coordinated update.

**Contract**:

- Imports `deleteAccount` and `USER_SCOPED_TABLES` from `./account.service`.
- Builds a minimal `SupabaseClient`-shaped stub with `from(table)` returning a chain (`select().eq().limit()` / `select("*", { count, head }).eq()`) whose return values are controllable per test. Include the `auth.admin.deleteUser` method on the stub. Do NOT import `@supabase/supabase-js` types beyond `SupabaseClient` for casting.
- Test cases:
  1. **`auth.admin.deleteUser` errors**: pre-count returns `{ count: 5, error: null }`; `deleteUser` returns `{ error: { message: "auth service down" } }`; `deleteAccount` returns `{ data: null, error: "auth service down" }`. Orphan-check must not run (stub asserts the `.from()` call count did not increase after the initial pre-count).
  2. **Orphan-check finds a row**: pre-count returns `{ count: 3, error: null }`; `deleteUser` succeeds; the loop iteration for `flashcards` returns `{ data: [{ id: "fake-orphan" }], error: null }`; `deleteAccount` returns `{ data: null, error: "Verification failed: orphaned rows in flashcards" }`.
  3. **Orphan-check query errors** (Supabase-JS network hiccup): pre-count OK; `deleteUser` OK; loop returns `{ data: null, error: { message: "network hiccup" } }`; `deleteAccount` returns `{ data: null, error: "network hiccup" }`.
  4. **Pre-count errors**: pre-count returns `{ count: null, error: { message: "count failed" } }`; `deleteAccount` returns `{ data: null, error: "count failed" }`; `deleteUser` must not be called.
- Structural guard case: **`USER_SCOPED_TABLES` roster is complete** — the test file declares `const EXPECTED_USER_SCOPED_TABLES = ["flashcards"] as const;` and asserts `expect([...USER_SCOPED_TABLES].sort()).toEqual([...EXPECTED_USER_SCOPED_TABLES].sort())`. A test-file JSDoc block above the constant links to [context/foundation/lessons.md](../../foundation/lessons.md) and instructs future contributors: "when you add a new `user_id -> auth.users(id)` table, extend both this roster AND `USER_SCOPED_TABLES` in `account.service.ts`; the migration must declare `on delete cascade`."

### Success Criteria

#### Automated Verification

- `npm run test:unit -- account.service` passes (4 partial-failure cases + 1 structural guard case, 5 total).
- `npm run test:integration -- account-delete` passes (happy path + validation branch + unauth branch, 3 total).
- Type checking passes: `npx astro check`.
- Linting passes: `npm run lint`.

#### Manual Verification

- Temporarily add a new table entry to `USER_SCOPED_TABLES` in the service (e.g., `"decks"`) → `npm run test:unit -- account.service` fails on the roster-equality assertion within seconds. Revert; confirm passing.
- Temporarily add a stale entry to the test-side roster instead → same failure shape. Revert.

**Implementation Note**: After Phase 2 lands and both automated + manual verification pass, pause for confirmation before Phase 3.

---

## Phase 3: Risk #6 tests — FSRS wiring passthrough + review-surface RLS

### Overview

One unit file pins the wiring contract with a stubbed scheduler across all four rating values; one integration file proves a real round-trip through the API plus the two-user RLS coverage the review surface still lacks after Phase 2.

### Changes Required

#### 1. Unit test — FSRS wiring with stubbed scheduler

**File**: `src/lib/services/review.service.test.ts` (new)

**Intent**: Prove the call contracts of `rehydrate`, `serialize`, `previewRatings`, and `gradeCard` without touching FSRS math. Use `vi.mock("ts-fsrs", ...)` at the top of the file to replace the scheduler module with a spy factory; keep `Rating` real so tests can pass `Rating.Again` etc. as inputs.

**Contract**:

- Top of file: `vi.mock("ts-fsrs", async () => { ... })` factory that re-exports the real `Rating` enum (via `await vi.importActual`) and returns a `fsrs()` factory producing an object `{ next: vi.fn(), repeat: vi.fn() }`. The mock uses `vi.hoisted` so the spies are addressable from tests via a shared reference. Pattern lifted from [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts#L1) `vi.hoisted` block.
- Import `rehydrate`, `serialize`, `previewRatings`, `gradeCard` from `./review.service`.
- **`rehydrate` identity round-trip**: build a full `Flashcard` fixture with realistic FSRS field values (non-zero `stability`, `difficulty`, non-null `last_review`); assert `serialize(rehydrate(row))` yields the same FSRS subset as `row` (only FSRS columns, converted through the `Date`↔`string` boundary). One case with `last_review: null` to prove the null-passthrough.
- **`previewRatings` wiring** — `it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])`:
  - Scheduler-repeat spy resolves with a synthetic `RecordLogItem` object per rating: `{ [Rating.Again]: { card: { due: new Date("2030-01-01") } }, ...`.
  - Call `previewRatings(row, new Date("2027-01-01"))`.
  - Assert `scheduler.repeat` was called once with `(rehydrate(row), new Date("2027-01-01"))` (deep-equal on the rehydrated card).
  - Assert the returned `RatingPreview.<key>` equals the corresponding scheduler-return `.card.due` for each of the four keys.
- **`gradeCard` wiring** — `it.each` over the four ratings:
  - Stub Supabase client with chainable `.from().select().eq().eq().maybeSingle()` returning `{ data: <row>, error: null }`, and `.from().update().eq().eq().select().maybeSingle()` returning `{ data: <serialized-updated-row>, error: null }`.
  - `scheduler.next` spy returns `{ card: <a fake Card object>, log: {} }`.
  - Call `gradeCard(supabase, "card-uuid", "user-uuid", rating)`.
  - Assertions: `scheduler.next` called once with `(rehydrate(<row>), <a Date>, rating)`; the `.update(...)` call received `serialize(<fake card>)` exactly (deep-equal); both `.eq` calls passed `("id", "card-uuid")` and `("user_id", "user-uuid")`; `gradeCard` returned `{ data: <serialized-updated-row>, error: null }`.
  - Use `vi.useFakeTimers()` in `beforeEach` (set to a fixed ISO instant) so the `<a Date>` assertion is exact.
- **`gradeCard` scoping guard**: when `.maybeSingle()` returns `{ data: null, error: null }` (RLS filtered / wrong user), `gradeCard` returns `{ data: null, error: "Flashcard not found" }` and `scheduler.next` is NOT called.
- **`gradeCard` upstream error passthrough**: when `.maybeSingle()` returns `{ data: null, error: { message: "db down" } }`, `gradeCard` returns `{ data: null, error: "db down" }`.

#### 2. Integration test — API round-trip + review-surface RLS

**File**: `src/lib/services/review.service.integration.test.ts` (new)

**Intent**: Prove the wiring works end-to-end through the review endpoints, and close the Risk #3 gap the Phase 2 test file left open (review sub-routes were not covered).

**Contract**:

- Imports the `POST` handler from `@/pages/api/flashcards/[id]/review` and the `GET` handler from `@/pages/api/flashcards/review/queue`.
- Uses `createIntegrationUser` for actor + other; signs actor in; seeds one flashcard for actor with a past `due` timestamp and 3 flashcards for other, via the service-role client. Reset both users' rows in `beforeEach`/`afterEach` following [flashcards-cross-user.integration.test.ts](../../../test/rls/flashcards-cross-user.integration.test.ts#L74) pattern.
- Test cases:
  1. **Grade round-trip**: capture actor's card row *before* via `readFlashcardById`; call `POST /api/flashcards/[id]/review` with `{ rating: Rating.Good }`; assert response status 200 and `body.data.id` equals the card id; re-read via `readFlashcardById` and assert at least one of `reps`, `stability`, `difficulty`, `last_review`, `due` changed from the before-state (proves the scheduler ran and its output was persisted); assert `updated_at` bumped.
  2. **Practice short-circuit pin**: capture the row *before*; call `POST` with `{ rating: Rating.Good, practice: true }`; assert response is 200 with body `{ data: null, skipped: true }`; re-read the row and assert every FSRS column is byte-identical (nothing was written).
  3. **Grade foreign card returns 404 with no side effect**: seed a card for `other`; capture it *before*; actor calls `POST /api/flashcards/{other-card-id}/review` with `{ rating: Rating.Good }`; assert response status 404 with `{ error: "Flashcard not found" }`; re-read the other-user's row via admin client and assert every FSRS column is byte-identical.
  4. **Grade unauthenticated returns 401**: invoke handler with no session; assert 401 `{ error: "Unauthorized" }`.
  5. **Queue only returns actor's cards**: seed 1 actor card + 3 other cards; actor calls `GET /api/flashcards/review/queue?mode=due`; assert response status 200 and `body.data.every(card => card.user_id === actor.userId)` is true and `body.data.length === 1`.
  6. **Queue unauthenticated returns 401 from middleware**: same `onRequest` pattern used in [flashcards-cross-user.integration.test.ts#L108](../../../test/rls/flashcards-cross-user.integration.test.ts#L108) for the middleware unauth path.

### Success Criteria

#### Automated Verification

- `npm run test:unit -- review.service` passes (2 identity + 4 preview + 4 grade + 1 not-found + 1 upstream-error = 12 cases).
- `npm run test:integration -- review.service` passes (6 cases).
- Type checking passes: `npx astro check`.
- Linting passes: `npm run lint`.

#### Manual Verification

- Break the wiring temporarily (in `gradeCard`, swap `.eq("user_id", userId)` on the update chain for a hardcoded `"wrong-user"`) → integration test #3 fails (foreign-card write succeeds under RLS bypass? No — actor's own grade fails on the update phase because `.eq("user_id","wrong-user")` matches no rows). Revert.
- Break the passthrough temporarily (in `gradeCard`, pass `serialize({...card, stability: 999})` instead of `serialize(card)`) → unit test on `gradeCard`'s `.update(...)` deep-equal fails. Revert.
- Break the practice short-circuit (delete the `practice === true` branch in the endpoint) → integration test #2 fails because the row now changes. Revert.

**Implementation Note**: After Phase 3 lands and both automated + manual verification pass, pause for confirmation before Phase 4.

---

## Phase 4: Cookbook sync

### Overview

Fill in the two cookbook sub-sections whose "TBD — see §3 Phase 3" placeholders exist in [test-plan.md](../../foundation/test-plan.md) so the next contributor adding a user-scoped table or an FSRS-adjacent feature has the pattern ready to copy. Append a §6.6 note capturing anything surprising the rollout taught.

### Changes Required

#### 1. Fill test-plan §6.4 — new user-scoped table pattern

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Replace the "TBD — see §3 Phase 3" placeholder in §6.4 with a concrete recipe covering: cascade in migration, extend `USER_SCOPED_TABLES` in `account.service.ts`, extend the roster in `account.service.test.ts`, seed a fixture row in the account-delete integration for confidence. Point at the lessons.md rule.

**Contract**: §6.4 gains bullet items with the same shape as §6.2:
- Reference test: `src/lib/services/account.service.test.ts` (structural guard) + `test/account-deletion/account-delete.integration.test.ts` (happy path).
- Pattern: (a) declare `on delete cascade` in the migration; (b) add the table name to `USER_SCOPED_TABLES` in `src/lib/services/account.service.ts`; (c) mirror the roster in `EXPECTED_USER_SCOPED_TABLES` in the unit test; (d) in the integration happy-path test, seed at least one fixture row in the new table before calling the endpoint and assert zero rows remain after; (e) confirm `npm run test:unit -- account.service` passes (the guard) and `npm run test:integration -- account-delete` passes (the full sweep).
- Cross-link the [lessons.md](../../foundation/lessons.md) rule.

#### 2. Fill test-plan §6.5 — FSRS wiring pattern

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Replace the "TBD — see §3 Phase 3" placeholder in §6.5 with a concrete recipe: stub the `ts-fsrs` module at the boundary, keep `Rating` real via `vi.importActual`, assert on the call + passthrough, never assert a specific next-due date, one integration per endpoint proving the real scheduler runs.

**Contract**: §6.5 gains bullet items:
- Reference test: `src/lib/services/review.service.test.ts` (unit, stubbed scheduler) + `src/lib/services/review.service.integration.test.ts` (one round-trip per endpoint).
- Pattern: (a) unit test uses `vi.mock("ts-fsrs")` with `vi.importActual` to preserve `Rating`; (b) assert `scheduler.next` / `scheduler.repeat` was called with the rehydrated card + a Date + rating; (c) assert the persisted or returned state deep-equals `serialize(<mock-scheduler-return>)`; (d) never assert a specific next-due date computed from the real scheduler; (e) integration proves the endpoint ran the real scheduler at least once by asserting FSRS columns changed (state-shape assertion), not by asserting specific values.
- Cross-link the test-plan §2 Risk #6 anti-pattern column.

#### 3. Append §6.6 phase-3 note

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Add a 2-3 line note under §6.6 capturing the load-bearing surprises Phase 3 taught. Draft content is written during the phase and refined at merge time; the plan does not pre-decide the exact wording. Candidate topics (choose the ones that actually mattered by then): fake timers were required to pin `new Date()` in `gradeCard`; the `USER_SCOPED_TABLES` const doubles as internal documentation for the extensibility rule and the guard test; the `practice: true` short-circuit is a regression-pin, not a wiring test.

**Contract**: Prepend the phase-3 note *below* the existing Phase-1 and Phase-2 paragraphs in §6.6, matching that section's paragraph shape. No bullet list.

### Success Criteria

#### Automated Verification

- `npm run lint` passes (prettier reformats the markdown as needed via husky).
- `git diff context/foundation/test-plan.md` shows edits only in §6.4, §6.5, §6.6 (no drift into §1–§5, §7, §8).

#### Manual Verification

- Read the two filled-in sub-sections top-to-bottom. Ask: could a new contributor add a user-scoped table (or an FSRS-adjacent function) without asking questions, using only the recipe here? If no, revise.

**Implementation Note**: After Phase 4 lands, this change is complete. `/10x-archive` moves it to `context/archive/`.

---

## Testing Strategy

### Unit Tests

- `src/lib/services/account.service.test.ts` — 4 hermetic partial-failure branches + 1 structural roster-equality guard.
- `src/lib/services/review.service.test.ts` — `rehydrate`/`serialize` identity (2 fixtures: full state + null `last_review`), `previewRatings` wiring across 4 ratings, `gradeCard` wiring across 4 ratings, `gradeCard` not-found guard, `gradeCard` upstream-error passthrough.
- Stub-scheduler pattern uses `vi.mock("ts-fsrs")` at file top; `Rating` is preserved via `await vi.importActual`.
- Stub-Supabase pattern is inline (no shared helper) — each test constructs the minimum chain surface it needs to keep the mock's shape explicit.

### Integration Tests

- `test/account-deletion/account-delete.integration.test.ts` — happy path (303 + audit log + zero rows across `USER_SCOPED_TABLES` + zero `auth.users`), validation branch (400 + rows preserved), unauth (401).
- `src/lib/services/review.service.integration.test.ts` — grade round-trip + practice short-circuit pin + foreign-card 404 + unauth 401 + queue actor-only + queue middleware unauth.
- Local Supabase required (`npx supabase start`) with `TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY` exported. Same env contract as Phase 2.
- Users are hermetic (`createIntegrationUser` with random suffix); DB state read for assertions via `readFlashcardById` / new `readFlashcardsForUser` if useful (add to `test/helpers/db.ts` only if the queue test needs it and existing `readFlashcards` is close enough).

### Manual Testing Steps

1. `npx supabase start`; export the three `TEST_SUPABASE_*` env vars from `npx supabase status`.
2. `npm run test:unit` — expect 12 review-service + 5 account-service unit cases passing.
3. `npm run test:integration` — expect 3 account-delete + 6 review-service integration cases passing, plus the existing Phase 1 + Phase 2 files still green.
4. Perform the Phase 2 structural-guard sabotage: add `"decks"` to `USER_SCOPED_TABLES`; re-run unit tests → the roster-equality assertion fails. Revert.
5. Perform the Phase 3 wiring sabotage: in `gradeCard`, change `serialize(card)` to `{ ...serialize(card), stability: 999 }`; re-run unit tests → `gradeCard` `.update` deep-equal fails. Revert.
6. Delete an account manually via the UI: [dashboard/settings](http://localhost:4321/dashboard/settings) → confirm dialog → observe redirect + audit log line. Sanity check the const-refactor did not regress the real flow.

## Performance Considerations

Integration tests spin one or two Supabase users per test via the service-role client. Users are randomly-suffixed; local DB is disposable. No performance budget concerns at Phase 3 scale. If future phases run against remote Supabase, per-test user creation cost climbs — flag it there.

## Migration Notes

None. The `USER_SCOPED_TABLES` extraction is a pure source refactor; no schema change, no data change, no deploy step beyond a normal PR merge. Test-plan cookbook edits are markdown-only.

## References

- Test plan (rollout state): [context/foundation/test-plan.md](../../foundation/test-plan.md) §3 Phase 3, §2 Risks #5 + #6, §6.4 + §6.5 placeholders.
- Lessons rule: [context/foundation/lessons.md](../../foundation/lessons.md) "User-scoped tables must cascade on `auth.users` delete AND be covered by the orphan-check".
- Deletion service source: [src/lib/services/account.service.ts](../../../src/lib/services/account.service.ts).
- Deletion endpoint source: [src/pages/api/account/delete.ts](../../../src/pages/api/account/delete.ts).
- FSRS wiring source: [src/lib/services/review.service.ts](../../../src/lib/services/review.service.ts).
- Review endpoints: [src/pages/api/flashcards/[id]/review.ts](../../../src/pages/api/flashcards/[id]/review.ts), [src/pages/api/flashcards/review/queue.ts](../../../src/pages/api/flashcards/review/queue.ts).
- Migration with cascade: [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) line 13.
- Test-harness helpers: [test/helpers/integration-user.ts](../../../test/helpers/integration-user.ts), [test/helpers/invoke-api-route.ts](../../../test/helpers/invoke-api-route.ts), [test/helpers/db.ts](../../../test/helpers/db.ts), [test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts).
- Reference test-pattern precedents: [src/lib/services/ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts) (`vi.hoisted` + module mock), [test/rls/flashcards-cross-user.integration.test.ts](../../../test/rls/flashcards-cross-user.integration.test.ts) (two-user integration harness), [src/components/dashboard/GenerateFlashcards.integration.test.tsx](../../../src/components/dashboard/GenerateFlashcards.integration.test.tsx) (API route + fetch stub — not directly used here but same pattern family).
- Prior deletion change (context): [context/archive/2026-06-24-account-deletion-gdpr/plan.md](../../archive/2026-06-24-account-deletion-gdpr/plan.md).
- Phase 2 sibling rollout: [context/changes/testing-rls-cross-user-access/plan.md](../testing-rls-cross-user-access/plan.md).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract `USER_SCOPED_TABLES` in `account.service.ts`

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — 2932307
- [x] 1.2 Linting passes: `npm run lint` — 2932307
- [x] 1.3 Build passes: `npm run build` — 2932307

#### Manual

- [x] 1.4 Manual delete flow still works end-to-end (sign up → create flashcards → `POST /api/account/delete` → 303 → auth row and flashcards row gone) — 2932307

### Phase 2: Risk #5 tests — account deletion completeness

#### Automated

- [x] 2.1 `npm run test:unit -- account.service` passes (4 partial-failure cases + 1 structural guard case) — 260f0bd
- [x] 2.2 `npm run test:integration -- account-delete` passes (happy path + validation branch + unauth branch) — 260f0bd
- [x] 2.3 Type checking passes: `npx astro check` — 260f0bd
- [x] 2.4 Linting passes: `npm run lint` — 260f0bd

#### Manual

- [x] 2.5 Roster-equality guard fires when `USER_SCOPED_TABLES` in the service is temporarily extended — 260f0bd
- [x] 2.6 Roster-equality guard fires when the test-side roster is temporarily extended — 260f0bd

### Phase 3: Risk #6 tests — FSRS wiring passthrough + review-surface RLS

#### Automated

- [x] 3.1 `npm run test:unit -- review.service` passes (12 cases)
- [x] 3.2 `npm run test:integration -- review.service` passes (6 cases)
- [x] 3.3 Type checking passes: `npx astro check`
- [x] 3.4 Linting passes: `npm run lint`

#### Manual

- [x] 3.5 Wiring sabotage on `.eq("user_id", ...)` is caught by a Phase 3 test
- [x] 3.6 Passthrough sabotage on `serialize(card)` is caught by the unit test's `.update` deep-equal
- [x] 3.7 Practice-short-circuit sabotage is caught by integration test #2

### Phase 4: Cookbook sync

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `git diff context/foundation/test-plan.md` shows edits only in §6.4, §6.5, §6.6

#### Manual

- [x] 4.3 Read §6.4 and §6.5 top-to-bottom — a new contributor could follow the recipe without asking questions
