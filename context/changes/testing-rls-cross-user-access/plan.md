# Cross-user access tests for flashcards CRUD (Risk #3) — Implementation Plan

## Overview

Lock the "user A cannot touch user B's flashcards" contract as durable integration tests over the four flashcards CRUD endpoints (`GET/POST /api/flashcards`, `PUT/DELETE /api/flashcards/[id]`), plus a structural guard that fails `npm run lint` if any future edit imports `@/lib/supabase-admin` into the flashcards or dashboard surface. Groundwork extends the Phase 1 test harness from one user to N users with a reusable `invokeApiRoute()` helper — the same infra Rollout Phase 2 changes for Risks #4 and #7 will inherit.

## Current State Analysis

- **Three-layer defense already in place, verified manually only.** Middleware pre-gates every `/api/flashcards*` request with 401 ([src/middleware.ts:20-27](../../../src/middleware.ts#L20-L27)); the anon Supabase client is cookie-scoped ([src/lib/supabase.ts:9-30](../../../src/lib/supabase.ts#L9-L30)); services `.eq("user_id", userId)` on writes ([src/lib/services/flashcard.service.ts:45-76](../../../src/lib/services/flashcard.service.ts#L45-L76)) and PostgreSQL RLS enforces per-command policies ([supabase/migrations/20260531120000_create_flashcards.sql:30-46](../../../supabase/migrations/20260531120000_create_flashcards.sql#L30-L46)).
- **List (GET) has no explicit `user_id` predicate** — `listFlashcards` is a bare `.from("flashcards").select("*")` ([src/lib/services/flashcard.service.ts:14-21](../../../src/lib/services/flashcard.service.ts#L14-L21)). RLS is the sole enforcement mechanism for the read path. Tests must lock this in.
- **Not-owner writes return 404, not 403.** `.eq("user_id", userId)` finds 0 rows; the handler maps `!response.count` / `!response.data` to `"Flashcard not found"` and a 404 ([src/pages/api/flashcards/[id].ts:52-53,81-82](../../../src/pages/api/flashcards/[id].ts#L52-L53)). This is intentional (anti-enumeration) and is a **user-visible product contract**.
- **`@/lib/supabase-admin` is walled off in exactly one file** — `src/pages/api/account/delete.ts` ([src/lib/supabase-admin.ts:1-14](../../../src/lib/supabase-admin.ts#L1-L14)). Zero imports on the flashcards CRUD surface. That fact protects the entire read path from silent bypass and is worth pinning at edit-time.
- **Request-body Zod schemas do NOT include `user_id`** ([src/lib/schemas/flashcard.schemas.ts:10-19](../../../src/lib/schemas/flashcard.schemas.ts#L10-L19)) — default `z.object` strips unknowns, so a body carrying `user_id: <other>` cannot spoof ownership. Behaviour worth pinning against future refactors to `passthrough` mode.
- **Phase 1 test harness seeds one user, exposes helpers.** [test/setup/global-integration.ts](../../../test/setup/global-integration.ts) seeds `test@integration.local`; [test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts) hard-codes it via `signInTestUser()`; [test/helpers/api-route-fetch-stub.ts](../../../test/helpers/api-route-fetch-stub.ts) builds a synthetic `APIContext` inline for `POST /api/flashcards`; [test/helpers/db.ts](../../../test/helpers/db.ts) provides `resetFlashcards(userId)` / `readFlashcards(userId)`. All are shaped for a single user.
- **`createClient(headers, cookies)` reads session only from the `Cookie` request header** ([src/lib/supabase.ts:12-25](../../../src/lib/supabase.ts#L12-L25)) via `parseCookieHeader`. The `AstroCookies` param is used only in the `setAll` refresh callback — tests don't need to fully simulate `AstroCookies` writes.
- **Two-user cross-access has never been automated.** [context/archive/2026-05-31-manual-flashcard-crud/plan.md:32](../../../context/archive/2026-05-31-manual-flashcard-crud/plan.md#L32) explicitly deferred it. This plan is that deferred coverage.

## Desired End State

- `npm run test:integration` includes a new `test/rls/flashcards-cross-user.integration.test.ts` that asserts the full oracle table from [research.md §6](./research.md) plus the POST body-spoof and PUT `updated_at`-untouched pins, all green against local Supabase.
- `npm run lint` fails if any file in `src/pages/api/flashcards/**`, `src/pages/api/dashboard/**`, `src/lib/services/flashcard.service.ts`, or `src/lib/services/review.service.ts` imports from `@/lib/supabase-admin`.
- Test helpers generalize from one user to N: `signInUser(email, password)`, `createIntegrationUser()`, `invokeApiRoute({ method, pathname, params, body, session })`, `readFlashcardById(id)`.
- Cookbook §6.2 in [test-plan.md](../../foundation/test-plan.md) grows a two-user pattern paragraph and §6.6 gets a Phase 2 note.

**Verification**: `npm run test:integration` exits 0 with the new file listed; deliberately disabling any of the four RLS policies on `public.flashcards` (via a local migration + `supabase db reset`) causes exactly the corresponding test to fail; deliberately adding `import { createAdminClient } from "@/lib/supabase-admin";` to `src/lib/services/flashcard.service.ts` causes `npm run lint` to fail with a clear message pointing at the rule.

### Key Discoveries:

- Cookie format is centralized in [test/helpers/supabase-session.ts:16-45](../../../test/helpers/supabase-session.ts#L16-L45): base64url-encoded `JSON.stringify(session)` wrapped as `base64-<...>`, named `sb-<project-ref>-auth-token`. Reusable as-is once parametrized by email/password.
- Existing `APIContext` fabrication in [test/helpers/api-route-fetch-stub.ts:20-98](../../../test/helpers/api-route-fetch-stub.ts#L20-L98) already builds `request` + `cookies` sink + `locals.user` — needs generalization from "POST /api/flashcards only" to "any method/pathname with `params`" and to accept a `session` bag instead of `{ userId, sessionCookie }` args.
- Handler-level `if (!context.locals.user) return 401` is redundant with middleware but present ([src/pages/api/flashcards/[id].ts:28,71](../../../src/pages/api/flashcards/[id].ts#L28)). Direct-handler unauth tests hit this path; a **separate** direct `onRequest` test hits the middleware path — both need pinning because they're different code.
- `updateFlashcardSchema` and `createFlashcardSchema` use default `z.object` mode — extra keys are silently dropped ([src/lib/schemas/flashcard.schemas.ts:10-19](../../../src/lib/schemas/flashcard.schemas.ts#L10-L19)). The POST-spoof test would fail if a future refactor switches to `.passthrough()`.

## What We're NOT Doing

- **Not testing Risks #4 or #7.** [change.md](./change.md) scope-freeze: Risk #4 (source-text non-retention) and Risk #7 (server-side input validation) get their own change folders. Their tests will reuse the same `invokeApiRoute()` helper Phase 1 of this plan produces — that's the only cross-change coupling.
- **Not writing hermetic stubs.** Every Risk #3 failure mode (RLS blocks read, RLS blocks write, admin-client bypass) is reproducible against real local Supabase. No stub gives cheaper signal than the integration test.
- **Not testing review / generation / account endpoints.** Scope locked at flashcards CRUD in [change.md](./change.md).
- **Not testing FSRS state RLS.** FSRS columns live on `public.flashcards` and inherit the four per-command policies ([supabase/migrations/20260601120000_flashcards_fsrs.sql:10-21](../../../supabase/migrations/20260601120000_flashcards_fsrs.sql#L10-L21)) — no separate RLS surface. Any FSRS-specific coverage belongs in Rollout Phase 3 (Risk #6).
- **Not touching `.github/workflows/ci.yml`.** Rollout Phase 4 wires `npm test` into CI; until then, the suite runs on the developer machine only. See [test-plan.md §3](../../foundation/test-plan.md).
- **Not refactoring product code.** Handlers keep calling `createClient(context.request.headers, context.cookies)`; tests adapt to that surface. See CookieInjection decision in [plan-brief.md](./plan-brief.md).
- **Not flipping the [test-plan.md §3 Phase 2](../../foundation/test-plan.md) status row.** The orchestrator (`/10x-test-plan`) does that.

## Implementation Approach

Four sequential phases. Phase 1 is **environment setup** — nothing about Risk #3 gets asserted; it lifts three existing single-user helpers into N-user shape and validates them with one smoke `it()` per helper. Phase 2 is the risk-anchored integration test, one file, ~9 assertions from the oracle. Phase 3 is the structural guard as an ESLint rule (edit-time, zero runtime cost) verified with a temporary bad import. Phase 4 syncs the cookbook. Phases 3 and 4 are independent of each other and could ship in either order after Phase 2; the numbered ordering below reflects a natural review sequence.

## Critical Implementation Details

### Cookie shape for `createClient(headers, cookies)`

The current handler always calls `createClient(context.request.headers, context.cookies)`; the `AstroCookies` sink is used only in the `setAll` refresh callback. Tests inject the session via the `Cookie` request header alone — the existing fake `AstroCookies` sink in [test/helpers/api-route-fetch-stub.ts:22-40](../../../test/helpers/api-route-fetch-stub.ts#L22-L40) is sufficient (reads reflect the header, writes are no-ops). The base64url-of-`session` cookie format at [test/helpers/supabase-session.ts:16-45](../../../test/helpers/supabase-session.ts#L16-L45) is pinned by observation of `@supabase/ssr` output — same trade already accepted in Phase 1. If `@supabase/ssr` changes shape upstream, one file breaks and it's this one.

### `updated_at` is a DB trigger, not a service concern

[supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) sets `updated_at` on any successful UPDATE. A not-owner PUT reaches `.eq("id", id).eq("user_id", userId)` matching zero rows → PostgREST issues no UPDATE → trigger doesn't fire → `updated_at` is genuinely untouched. The OQ-5 assertion checks the DB row's `updated_at` **exactly equals** the pre-test value read via admin client, not "within N seconds" — because the semantics is "no write happened at all", not "the write was fast enough".

### ESLint rule wording

`no-restricted-imports` with a `patterns` clause targets `@/lib/supabase-admin` specifically. The rule lives in [eslint.config.js](../../../eslint.config.js) as an `overrides` block scoped by `files` glob to the four paths in scope. Message text should point at this plan's rationale so a future dev seeing the lint error understands why. Verification is a temporary import that must fail lint and then be removed — captured as a two-step manual verification in Phase 3.

---

## Phase 1: Two-user harness + APIContext helper

### Overview

Lift the three Phase-1 test helpers from single-user shape into N-user shape without changing product code. This phase asserts nothing about Risk #3 — it exists so Phase 2 can be written in ~9 test cases without inlined plumbing. Success = the helpers exist, are typed, and pass a smoke test each.

### Changes Required:

#### 1. Generalize `signInTestUser` to `signInUser(credentials)`

**File**: [test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts)

**Intent**: Break the hard-coded coupling to `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` so a test can sign in either the seeded primary user or a per-test factory user.

**Contract**: Export `signInUser({ email: string, password: string }): Promise<{ userId: string; cookieHeader: string }>`. Retain `signInTestUser()` as a thin wrapper (`signInUser({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })`) so the existing Phase 1 integration test file keeps working with no edit. Cookie format and name derivation stay in this file.

#### 2. Per-test user factory

**File**: `test/helpers/integration-user.ts` (extend existing)

**Intent**: Create fresh, hermetic users on demand for tests that need > 1 user without touching `globalSetup`. Random suffix keeps parallel/rerun-safety; admin client seeds via `auth.admin.createUser`.

**Contract**: Export `createIntegrationUser(overrides?: { emailPrefix?: string; password?: string }): Promise<{ email: string; password: string; userId: string; signIn(): Promise<{ userId: string; cookieHeader: string }> }>`. Email defaults to `test-<8-char-hex>@integration.local`; password defaults to a constant so the returned `signIn()` can call `signInUser` internally. Idempotency error swallowing follows the pattern already in [test/setup/global-integration.ts:41-46](../../../test/setup/global-integration.ts#L41-L46). No automatic cleanup — local DB, disposable.

#### 3. Reusable API-route invoker

**File**: `test/helpers/invoke-api-route.ts` (new)

**Intent**: Lift the `APIContext` fabrication from [api-route-fetch-stub.ts](../../../test/helpers/api-route-fetch-stub.ts) into a standalone helper that any integration test can call without going through a fetch stub. The fetch-stub path stays as-is (its RTL-driven callers still need it); this new helper is for tests that talk to Astro routes directly.

**Contract**: Export `invokeApiRoute<T = unknown>(options: { method: "GET" | "POST" | "PUT" | "DELETE"; pathname: string; params?: Record<string, string>; body?: unknown; session?: { userId: string; cookieHeader: string }; handler: (context: APIContext) => Response | Promise<Response> }): Promise<Response>`. The caller passes the imported handler directly (e.g. `handler: (await import("@/pages/api/flashcards/index")).GET`) — this keeps route→handler mapping explicit at each call site rather than replicating Astro's router in test code. `context.locals.user` derives from `session?.userId` (present ↔ authenticated); if `session` is omitted, `locals.user = null` mimics the "middleware didn't set it" state. The cookie sink from [api-route-fetch-stub.ts:22-40](../../../test/helpers/api-route-fetch-stub.ts#L22-L40) moves into this file; keep a re-export from `api-route-fetch-stub.ts` so no existing test breaks.

#### 4. Admin post-check reader

**File**: [test/helpers/db.ts](../../../test/helpers/db.ts)

**Intent**: Read individual rows by id via the service-role client so cross-user tests can verify "row still exists for user B" without going through the anon client (which RLS-filters).

**Contract**: Add `readFlashcardById(id: string): Promise<Flashcard | null>`. Uses the existing `createServiceRoleClient()` internal factory. Returns `null` if the row is genuinely gone; the calling test decides whether that's a pass or fail per case. `resetFlashcards(userId)` keeps its shape — the factory-created users are cleaned up by dropping their flashcards row-by-row, which the calling test does explicitly.

#### 5. Smoke tests for the new helpers

**File**: `test/helpers/harness.smoke.integration.test.ts` (new — small file that exercises each helper once)

**Intent**: Prove the harness works before Phase 2 depends on it. Not a regression net for Risk #3 — a wiring net for the helpers.

**Contract**: Three `it()` cases in one file:
- `createIntegrationUser + signIn produces a working session` — creates a user, calls `signIn()`, hits `GET /api/flashcards` via `invokeApiRoute`, expects HTTP 200 with `data: []`.
- `invokeApiRoute with no session returns 401 from the handler` — calls PUT with `session: undefined`, expects 401 (handler-level `!context.locals.user` branch).
- `readFlashcardById on a non-existent uuid returns null` — sanity.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` includes the smoke file and exits 0.
- `npx vitest run test/helpers/harness.smoke.integration.test.ts` exits 0 on its own.
- `npm run lint` stays green.
- `npm run build` stays green (no type regressions in helper signatures).

#### Manual Verification:

- Existing Phase 1 tests ([src/lib/services/ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts), [src/components/dashboard/GenerateFlashcards.integration.test.tsx](../../../src/components/dashboard/GenerateFlashcards.integration.test.tsx)) still pass with no edit — the `signInTestUser` re-export path stays functional.
- A test author reading `test/helpers/invoke-api-route.ts` can identify how to invoke any Astro API route without following a chain of imports.

**Implementation Note**: After Phase 1 lands and automated verification passes, pause for manual confirmation before starting Phase 2.

---

## Phase 2: RLS integration tests

### Overview

Land the risk-anchored integration test file that pins the full oracle table from [research.md §6](./research.md), plus the two cheap adds from OQ-4 (POST body-spoof) and OQ-5 (PUT `updated_at` non-change), plus one direct `onRequest` middleware test for the unauth path. Behavior asserted: **user A can neither observe nor mutate user B's flashcards via any of the four CRUD endpoints, and unauthenticated calls never reach handlers.** Regression caught: any weakening of RLS policies, any accidental switch to service-role client on this surface, any Zod passthrough that would let `user_id` be re-parented from the body, and any refactor that eliminates the 404 anti-enumeration contract.

### Changes Required:

#### 1. Cross-user integration test file

**File**: `test/rls/flashcards-cross-user.integration.test.ts` (new)

**Intent**: One file, one `describe('flashcards cross-user isolation')`, per-test `beforeEach` seeds two fresh users A and B via the Phase-1 factory. Every `it()` names the endpoint + scenario in the title so a failure report reads like the oracle.

**Contract**: Test cases (each is one `it()`), mapped to [research.md §6](./research.md#L200):

1. **`GET /api/flashcards` as A returns only A's rows** — Seed 2 rows for A, 3 rows for B (admin insert). Invoke `GET /api/flashcards` as A. Assert HTTP 200; response `data.length === 2`; every element's `user_id === A.userId`; no element's `id` is in B's inserted ids.
2. **`GET /api/flashcards` unauthenticated returns 401 (middleware path)** — Import `onRequest` from [src/middleware.ts](../../../src/middleware.ts). Build a minimal Astro middleware context (url `/api/flashcards`, empty cookies, empty locals) and a `next()` that returns `new Response(null, { status: 200 })`. Call `onRequest(context, next)`. Assert the returned response has status 401, JSON body `{ error: "Unauthorized" }`, and that `next` was NOT called (`vi.fn()` spy assertion).
3. **`POST /api/flashcards` drops `user_id` from body (spoof attempt)** — As user A, POST body `{ front: "F", back: "B", source: "manual", user_id: <B.userId> }`. Assert HTTP 201; response `data.user_id === A.userId`; `readFlashcardById(response.data.id)` returns a row with `user_id === A.userId` (never B).
4. **`PUT /api/flashcards/[B's id]` as A returns 404, row unchanged** — Admin-insert one row for B; capture `updated_at` before. Invoke `PUT /api/flashcards/[id]` as A with a valid body. Assert HTTP 404, body `{ error: "Flashcard not found" }`. Read the row via `readFlashcardById(bId)`: `front`, `back`, and `updated_at` all match the pre-test snapshot exactly.
5. **`DELETE /api/flashcards/[B's id]` as A returns 404, row still present** — Admin-insert one row for B. Invoke `DELETE /api/flashcards/[id]` as A. Assert HTTP 404. `readFlashcardById(bId)` returns a row (not null).
6. **`PUT /api/flashcards/[nonexistent uuid]` as A returns 404** — Invoke PUT with a random UUID neither user owns. Assert HTTP 404 with the same body as case (4). This pins that "not found" and "not yours" are indistinguishable to the caller — the anti-enumeration contract.
7. **`DELETE /api/flashcards/[nonexistent uuid]` as A returns 404** — Analogue of (6) for delete.
8. **`POST /api/flashcards` unauthenticated returns 401 (handler path)** — Invoke `POST /api/flashcards` via `invokeApiRoute` with `session: undefined`. Assert HTTP 401, body `{ error: "Unauthorized" }`.

Anti-patterns to avoid (from [test-plan.md §2 Risk #3](../../foundation/test-plan.md) + [research.md §7](./research.md)):
- Do NOT mock the Supabase client. RLS is the assertion target; a mock has no notion of policies.
- Do NOT assert `>= 200 && < 400`. Every status code is a product contract — 401 vs 404 is user-visible and load-bearing.
- Do NOT test only the happy path. Cases 3-7 are the point of this file.
- Do NOT snapshot response bodies. Assert on specific fields (`data.user_id`, `error: "Flashcard not found"`) so a benign field addition doesn't flag a regression.
- Do NOT skip the DB post-check on rejected writes. HTTP 404 alone doesn't prove the row is intact; only `readFlashcardById` does.

### Success Criteria:

#### Automated Verification:

- `npx vitest run test/rls/flashcards-cross-user.integration.test.ts` exits 0.
- `npm run test:integration` includes this file and exits 0.
- `npm run lint` stays green.
- `npx prettier --check "test/rls/flashcards-cross-user.integration.test.ts"` exits 0.

#### Manual Verification:

- Temporarily commenting out `.eq("user_id", userId)` in [src/lib/services/flashcard.service.ts:54-55](../../../src/lib/services/flashcard.service.ts#L54-L55) causes case (4) — PUT-not-owner — to fail. Revert.
- Temporarily changing `updateFlashcardSchema` to `.passthrough()` in [src/lib/schemas/flashcard.schemas.ts](../../../src/lib/schemas/flashcard.schemas.ts) alone does NOT break case (3) — because RLS `with check (auth.uid() = user_id)` still catches it — proving the belt-and-suspenders. Adding `.passthrough()` AND swapping the anon client for admin client would break case (3). Revert both.
- Test file reads top-to-bottom like the [research.md §6](./research.md) oracle table.

**Implementation Note**: After Phase 2 lands and automated verification passes, pause for manual confirmation before starting Phase 3.

---

## Phase 3: Structural guard on `@/lib/supabase-admin`

### Overview

Add an ESLint `no-restricted-imports` rule that fails `npm run lint` if any of the four scoped paths imports `@/lib/supabase-admin`. Behavior asserted: **the flashcards CRUD and dashboard surfaces run exclusively on the anon client.** Regression caught: edit-time. A future dev copy-pasting an admin-client call into a flashcards handler sees the lint error before the code ever runs. Zero runtime cost.

### Changes Required:

#### 1. ESLint rule scoped by file glob

**File**: [eslint.config.js](../../../eslint.config.js)

**Intent**: Restrict `@/lib/supabase-admin` imports for the four flashcards+dashboard surface paths listed in [research.md §4](./research.md). Message text names this plan so the reader knows where to look.

**Contract**: Add a flat-config object with `files: ["src/pages/api/flashcards/**", "src/pages/api/dashboard/**", "src/lib/services/flashcard.service.ts", "src/lib/services/review.service.ts"]` and `rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@/lib/supabase-admin", "@/lib/supabase-admin/**", "src/lib/supabase-admin", "src/lib/supabase-admin/**", "../lib/supabase-admin", "../../lib/supabase-admin"], message: "The flashcards CRUD surface must run on the anon client only. See context/changes/testing-rls-cross-user-access/plan.md Phase 3." }] }] }`. Placement: after the existing `astro` and `typescript` blocks; before the general `rules` block.

### Success Criteria:

#### Automated Verification:

- `npm run lint` exits 0 on the current codebase.
- Deliberately adding `import { createAdminClient } from "@/lib/supabase-admin";` (any style) to any one of the four scoped files causes `npm run lint` to fail with the message referencing this plan. (Executed as a temporary edit + revert during manual verification.)
- The rule does NOT apply to `src/pages/api/account/delete.ts` (verify: current import at [src/pages/api/account/delete.ts:5](../../../src/pages/api/account/delete.ts#L5) still lints clean).

#### Manual Verification:

- Run the "deliberately add the import" experiment on each of: `src/lib/services/flashcard.service.ts`, `src/lib/services/review.service.ts`, `src/pages/api/flashcards/index.ts`. Each must fail lint. Revert after each.
- `src/pages/api/account/delete.ts` still lints clean without changes.

**Implementation Note**: After Phase 3 lands and automated verification passes, pause for manual confirmation before starting Phase 4.

---

## Phase 4: Cookbook sync

### Overview

Extend [context/foundation/test-plan.md](../../foundation/test-plan.md) §6.2 with the two-user + `invokeApiRoute` pattern, and add a §6.6 phase note describing what Phase 2 of the rollout surfaced. No runtime assertion — documentation delta only. This phase does NOT flip the §3 Phase 2 status row from "not started" — that's the orchestrator's job.

### Changes Required:

#### 1. Cookbook §6.2 append

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Add a two-user harness paragraph after the existing §6.2 reference-test entry so a future contributor writing a two-user RLS test for a different table has the pattern.

**Contract**: Insert a subsection titled "Two-user / N-user harness" listing:
- factory helper `createIntegrationUser()` at [test/helpers/integration-user.ts](../../../test/helpers/integration-user.ts),
- direct-invoke helper `invokeApiRoute()` at [test/helpers/invoke-api-route.ts](../../../test/helpers/invoke-api-route.ts),
- admin post-check reader `readFlashcardById()` at [test/helpers/db.ts](../../../test/helpers/db.ts),
- reference test at [test/rls/flashcards-cross-user.integration.test.ts](../../../test/rls/flashcards-cross-user.integration.test.ts),
- pattern one-liner: "spin two hermetic users via `createIntegrationUser()`, invoke Astro handlers via `invokeApiRoute()` with the target user's cookies, assert on HTTP response AND on DB state via admin-client post-checks."

#### 2. §6.6 phase note

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: 2-3 line note capturing what was surprising during this rollout phase.

**Contract**: Append to §6.6: "**Phase 2 (Risk #3):** Direct `APIContext` fabrication is cheap; the `AstroCookies` sink only needs `.get`/`.getAll`/`.has` populated from the request `Cookie` header — writes are no-ops. ESLint `no-restricted-imports` with file-scoped overrides gave us an edit-time regression net over the admin-client surface at zero runtime cost."

### Success Criteria:

#### Automated Verification:

- `npx prettier --check "context/foundation/test-plan.md"` exits 0.
- `npm run lint` stays green (unrelated but must not regress).

#### Manual Verification:

- A reader landing on §6.2 can locate the reference test and helpers in one hop.
- §6.6 phase note reads as one paragraph, not a bullet dump.

**Implementation Note**: After Phase 4 lands, the change is complete and ready for `/10x-impl-review` and eventual `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- None in this change. Every risk in scope requires real RLS to give real signal.

### Integration Tests:

- Phase 1: 3 smoke `it()` in `test/helpers/harness.smoke.integration.test.ts` — proves the harness wiring.
- Phase 2: 8 `it()` in `test/rls/flashcards-cross-user.integration.test.ts` — proves Risk #3 across four endpoints, three failure classes (RLS filter, ownership predicate, middleware pre-gate), and two orthogonal pins (POST spoof, PUT updated_at non-change).

### Manual Testing Steps:

1. Verify the Phase 1 smoke test file discovers under `npm run test:integration` (Vitest project glob covers `test/**/*.integration.test.{ts,tsx}` — see [vitest.config.ts:34-45](../../../vitest.config.ts#L34-L45)).
2. Run the two Phase 2 mutation experiments listed in that phase's Manual Verification.
3. Run the three ESLint experiments listed in Phase 3's Manual Verification.

## References

- Research: [context/changes/testing-rls-cross-user-access/research.md](./research.md)
- Test plan Risk #3: [context/foundation/test-plan.md §2](../../foundation/test-plan.md)
- Rollout Phase 2 row: [context/foundation/test-plan.md §3](../../foundation/test-plan.md) — status stays "not started" until the orchestrator flips it
- Phase 1 harness precedent: [test/helpers/api-route-fetch-stub.ts](../../../test/helpers/api-route-fetch-stub.ts), [test/helpers/supabase-session.ts](../../../test/helpers/supabase-session.ts)
- Convention grounding: [context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md](../../archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md) — origin of the `.eq("user_id", userId)` defense-in-depth pattern

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Two-user harness + APIContext helper

#### Automated

- [x] 1.1 `npm run test:integration` includes the smoke file and exits 0. — a82e2ce
- [x] 1.2 `npx vitest run test/helpers/harness.smoke.integration.test.ts` exits 0 on its own. — a82e2ce
- [x] 1.3 `npm run lint` stays green. — a82e2ce
- [x] 1.4 `npm run build` stays green (no type regressions in helper signatures). — a82e2ce

#### Manual

- [x] 1.5 Existing Phase 1 tests (`ai-generation.service.test.ts`, `GenerateFlashcards.integration.test.tsx`) still pass with no edit. — a82e2ce
- [x] 1.6 A test author reading `test/helpers/invoke-api-route.ts` can identify how to invoke any Astro API route without following a chain of imports. — a82e2ce

### Phase 2: RLS integration tests

#### Automated

- [x] 2.1 `npx vitest run test/rls/flashcards-cross-user.integration.test.ts` exits 0. — 8179ea3
- [x] 2.2 `npm run test:integration` includes this file and exits 0. — 8179ea3
- [x] 2.3 `npm run lint` stays green.
- [x] 2.4 `npx prettier --check "test/rls/flashcards-cross-user.integration.test.ts"` exits 0.

#### Manual

- [x] 2.5 Temporarily commenting `.eq("user_id", userId)` in `updateFlashcard` breaks case (4). Revert. — 8179ea3
- [x] 2.6 Temporarily switching `updateFlashcardSchema` to `.passthrough()` does NOT break case (3) — RLS `with check` still catches it. Revert. — 8179ea3
- [x] 2.7 Test file reads top-to-bottom like the research.md §6 oracle table. — 8179ea3

### Phase 3: Structural guard on `@/lib/supabase-admin`

#### Automated

- [x] 3.1 `npm run lint` exits 0 on the current codebase.
- [x] 3.2 Deliberately adding the import to any of the four scoped files causes lint to fail with the plan-referenced message. Revert.
- [x] 3.3 `src/pages/api/account/delete.ts` still lints clean.

#### Manual

- [x] 3.4 The "deliberately add the import" experiment on each of `flashcard.service.ts`, `review.service.ts`, and `src/pages/api/flashcards/index.ts` fails lint. Revert each.

### Phase 4: Cookbook sync

#### Automated

- [ ] 4.1 `npx prettier --check "context/foundation/test-plan.md"` exits 0.
- [ ] 4.2 `npm run lint` stays green.

#### Manual

- [ ] 4.3 A reader landing on §6.2 can locate the reference test and helpers in one hop.
- [ ] 4.4 §6.6 phase note reads as one paragraph, not a bullet dump.
