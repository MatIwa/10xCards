---
date: 2026-07-01T00:00:00+02:00
researcher: GitHub Copilot
git_commit: 87287aa888b8faee7e73d9be81c9a165145be4d5
branch: master
repository: MatIwa/10xCards
topic: "Cross-user data leak on flashcards CRUD endpoints (test-plan Risk #3)"
tags: [research, codebase, rls, authorization, flashcards, phase-2]
status: complete
last_updated: 2026-07-01
last_updated_by: GitHub Copilot
---

# Research: Cross-user data leak on flashcards CRUD endpoints (Risk #3)

**Date**: 2026-07-01 (Europe/Warsaw)
**Researcher**: GitHub Copilot
**Git Commit**: `87287aa888b8faee7e73d9be81c9a165145be4d5`
**Branch**: `master`
**Repository**: `MatIwa/10xCards`

## Research Question

Establish the oracle for test-plan Risk #3 on the flashcards CRUD surface (list, create, detail-update, detail-delete): **user A must not be able to read, insert-as-if, update, or delete rows belonging to user B via any of the four endpoints, regardless of whether RLS is "on".** For each endpoint, identify:

- which Supabase client is used (anon vs service-role admin),
- how the caller's identity is established,
- whether the query has an explicit `user_id` predicate or relies on RLS alone,
- what the endpoint returns for unauthenticated calls and for authenticated calls targeting another user's row,
- and what an integration test would need to assert to catch a regression at the cheapest layer.

Scope (locked with the user before research): **flashcards CRUD only**. Review/queue, AI generation, and account endpoints are out of scope for this change.

## Summary

The flashcards CRUD surface is defended by a **three-layer stack**:

1. **Astro middleware** ([src/middleware.ts:20-27](src/middleware.ts#L20-L27)) pre-gates every `/api/flashcards*` request with a 401 if `context.locals.user` is falsy. Handlers additionally re-check the same locals — belt AND suspenders.
2. **PostgreSQL RLS** on `public.flashcards` — four per-command policies (`select`, `insert`, `update`, `delete`), all comparing `auth.uid() = user_id`, targeting the `public` role, RLS enabled ([supabase/migrations/20260531120000_create_flashcards.sql:30-46](supabase/migrations/20260531120000_create_flashcards.sql#L30-L46)).
3. **Explicit `user_id` predicates in the service layer** for the mutation paths (`updateFlashcard`, `deleteFlashcard` — both chain `.eq("id", id).eq("user_id", userId)`), and explicit `user_id` in the INSERT body for `createFlashcard`. This layer was added as defense-in-depth in `context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md`.

Two important asymmetries follow:

- **List (GET) has NO explicit predicate** — `listFlashcards` runs a bare `.from("flashcards").select("*")` ([src/lib/services/flashcard.service.ts:14-21](src/lib/services/flashcard.service.ts#L14-L21)). **RLS is the sole enforcement mechanism for the read path.** If RLS ever gets disabled or the policy predicate weakens, `GET /api/flashcards` immediately becomes a cross-user leak with no code-level backstop.
- **Not-owner writes return 404, not 403** ([src/pages/api/flashcards/[id].ts:52-53](src/pages/api/flashcards/[id].ts#L52-L53), [src/pages/api/flashcards/[id].ts:81-82](src/pages/api/flashcards/[id].ts#L81-L82)) — the `.eq("user_id", userId)` chain returns 0 rows/count for another user's UUID, and the handler treats "0 rows affected" as "not found". This is intentional (blocks enumeration) and is a **user-visible contract** the tests must lock in.

The service-role admin client is imported in **exactly one file** in the entire codebase — `src/pages/api/account/delete.ts` — and never appears in any flashcards CRUD path. There is **no client-mixing failure mode to test** on the flashcards CRUD surface. Confirmed by the full-repo client audit (see §4 below).

The `flashcards` request body Zod schemas (`createFlashcardSchema`, `updateFlashcardSchema` — [src/lib/schemas/flashcard.schemas.ts:10-19](src/lib/schemas/flashcard.schemas.ts#L10-L19)) do NOT include a `user_id` field, so `user_id` cannot be spoofed via body payload; the write path derives it exclusively from `context.locals.user.id`. This closes an obvious IDOR-via-body angle but is worth pinning with a test.

The integration test infrastructure landed in Phase 1 ([vitest.config.ts:34-45](vitest.config.ts#L34-L45), [test/setup/global-integration.ts:14-64](test/setup/global-integration.ts#L14-L64)) currently seeds **one** integration user (`test@integration.local`) via the admin client, signs it in, and exposes its ID through `getTestUserId()`. Risk #3 tests require a **second** independent user; the cheapest extension is a per-test helper that calls `auth.admin.createUser` with a random email and returns a signed-in anon client bound to that user's cookies.

## Detailed Findings

### 1. Endpoint surface — flashcards CRUD

Four route handlers, all under `src/pages/api/flashcards/`. Each is exercised by the same middleware pre-gate.

| Method | Route | Handler | Client used | Explicit `user_id` predicate | Unauth response | Not-owner response |
|---|---|---|---|---|---|---|
| GET | `/api/flashcards` | [src/pages/api/flashcards/index.ts:11-22](src/pages/api/flashcards/index.ts#L11-L22) | Anon (session-scoped) | ❌ RLS only | 401 (middleware) | 200 with rows filtered by RLS (never contains other user's rows) |
| POST | `/api/flashcards` | [src/pages/api/flashcards/index.ts:25-52](src/pages/api/flashcards/index.ts#L25-L52) | Anon | ✅ `user_id: context.locals.user.id` in service INSERT ([src/lib/services/flashcard.service.ts:30](src/lib/services/flashcard.service.ts#L30)) | 401 (middleware + handler line 34) | n/a — insert always uses the caller's `user_id` |
| PUT | `/api/flashcards/[id]` | [src/pages/api/flashcards/[id].ts:21-61](src/pages/api/flashcards/[id].ts#L21-L61) | Anon | ✅ `.eq("id", id).eq("user_id", userId)` in `updateFlashcard` ([src/lib/services/flashcard.service.ts:54-55](src/lib/services/flashcard.service.ts#L54-L55)) | 401 (middleware + handler line 28) | 404 (`"Flashcard not found"` → line 52-53) |
| DELETE | `/api/flashcards/[id]` | [src/pages/api/flashcards/[id].ts:64-90](src/pages/api/flashcards/[id].ts#L64-L90) | Anon | ✅ `.eq("id", id).eq("user_id", userId)` in `deleteFlashcard` ([src/lib/services/flashcard.service.ts:73](src/lib/services/flashcard.service.ts#L73)) | 401 (middleware + handler line 71) | 404 (`"Flashcard not found"` → line 81-82) |

#### 1a. Middleware pre-gate

[src/middleware.ts:1-32](src/middleware.ts#L1-L32) — every request:

1. Calls `createClient(context.request.headers, context.cookies)` — cookie-based anon client.
2. If the client exists, resolves `supabase.auth.getUser()` and stores the user (or `null`) on `context.locals.user`.
3. Checks `PROTECTED_API_PREFIXES = ["/api/flashcards", "/api/account"]` and `PROTECTED_ROUTES = ["/dashboard"]`.
4. If the route is protected AND `!context.locals.user`, returns `Response.json({ error: "Unauthorized" }, { status: 401 })` — API prefix branch on line 25.

Consequence: **unauthenticated flashcards requests never reach the handler.** Test assertions for the 401 shape should hit the middleware, not the handler.

#### 1b. Handler-level re-checks

Every mutation handler additionally checks `if (!context.locals.user) return 401` — [POST line 34](src/pages/api/flashcards/index.ts#L34), [PUT line 28](src/pages/api/flashcards/[id].ts#L28), [DELETE line 71](src/pages/api/flashcards/[id].ts#L71). This is defensive; the middleware already blocks. The GET handler ([src/pages/api/flashcards/index.ts:11-22](src/pages/api/flashcards/index.ts#L11-L22)) has NO handler-level user check — it relies entirely on the middleware and on RLS. That's intentional: if someone somehow gets past the middleware with `context.locals.user === null`, `supabase.auth.getUser()` would still return no session, so RLS would return zero rows, so the client sees `{ data: [] }` — not a leak, but also not a 401. Tests should not require a specific behaviour for that impossible-in-prod state.

### 2. Ownership predicates — code-level enforcement, per operation

**GET (list)** — [src/lib/services/flashcard.service.ts:14-21](src/lib/services/flashcard.service.ts#L14-L21):

```ts
export async function listFlashcards(supabase: SupabaseClient): Promise<DataResult<Flashcard[]>> {
  const response = await supabase.from("flashcards").select("*").order("created_at", { ascending: false });
  ...
}
```

No `userId` parameter. No `.eq("user_id", ...)`. **The RLS `select` policy is the entire enforcement mechanism for read isolation.**

**POST (create)** — [src/lib/services/flashcard.service.ts:26-42](src/lib/services/flashcard.service.ts#L26-L42):

```ts
export async function createFlashcard(supabase, input: CreateFlashcardInput, userId: string) {
  const response = await supabase.from("flashcards").insert({
    user_id: userId,
    front: input.front,
    back: input.back,
    source: input.source,
  })...
}
```

`user_id` comes from the handler's `context.locals.user.id` ([src/pages/api/flashcards/index.ts:50](src/pages/api/flashcards/index.ts#L50)). The `createFlashcardSchema` ([src/lib/schemas/flashcard.schemas.ts:10-14](src/lib/schemas/flashcard.schemas.ts#L10-L14)) has no `user_id` field — Zod's default `z.object` strips unknown keys, so a body like `{"front":"...","back":"...","user_id":"<other>"}` cannot spoof ownership. Additionally, the RLS `insert with check (auth.uid() = user_id)` policy would reject the row if code ever tried to insert with a different `user_id` than the caller.

**PUT (update)** — [src/lib/services/flashcard.service.ts:45-63](src/lib/services/flashcard.service.ts#L45-L63):

```ts
const response = await supabase
  .from("flashcards")
  .update(input)
  .eq("id", id)
  .eq("user_id", userId)
  .select("*")
  .maybeSingle();
...
if (!response.data) {
  return { data: null, error: "Flashcard not found" };
}
```

`updateFlashcardSchema` ([src/lib/schemas/flashcard.schemas.ts:16-19](src/lib/schemas/flashcard.schemas.ts#L16-L19)) is `{ front, back }` only — no `user_id`, so re-parenting via body is not reachable.

**DELETE** — [src/lib/services/flashcard.service.ts:65-76](src/lib/services/flashcard.service.ts#L65-L76):

```ts
const response = await supabase
  .from("flashcards")
  .delete({ count: "exact" })
  .eq("id", id)
  .eq("user_id", userId);
...
if (!response.count) {
  return { error: "Flashcard not found" };
}
```

Uses `count: "exact"` and treats `!response.count` as not-found. This is important: the endpoint distinguishes "row didn't exist" from "row exists but isn't yours" **by giving the same 404 to both** — that's the anti-enumeration property.

### 3. RLS policies on `public.flashcards`

Migration [supabase/migrations/20260531120000_create_flashcards.sql:30-46](supabase/migrations/20260531120000_create_flashcards.sql#L30-L46):

```sql
alter table public.flashcards enable row level security;

create policy flashcards_select_own on public.flashcards
  for select using (auth.uid() = user_id);

create policy flashcards_insert_own on public.flashcards
  for insert with check (auth.uid() = user_id);

create policy flashcards_update_own on public.flashcards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy flashcards_delete_own on public.flashcards
  for delete using (auth.uid() = user_id);
```

- Four policies, one per command. No `for all`. No open (`using (true)`) policy.
- All predicates compare against the `user_id` column via `auth.uid()`.
- All target the implicit `public` role (which includes `authenticated`).
- FK: `user_id uuid not null references auth.users(id) on delete cascade` ([supabase/migrations/20260531120000_create_flashcards.sql:9](supabase/migrations/20260531120000_create_flashcards.sql#L9)) — orphan-check on user delete is separately governed by Risk #5 and out of scope here.
- FSRS state added by [supabase/migrations/20260601120000_flashcards_fsrs.sql:10-21](supabase/migrations/20260601120000_flashcards_fsrs.sql#L10-L21) lives as columns on `public.flashcards`, so it inherits these policies — no separate RLS surface to test.

Verdict: policy shape is agent-friendly and complete for the four CRUD verbs.

### 4. Supabase client audit — no service-role client on the flashcards CRUD surface

`src/lib/supabase-admin.ts` ([src/lib/supabase-admin.ts:1-14](src/lib/supabase-admin.ts#L1-L14)) exports `createAdminClient()` that uses `SUPABASE_SERVICE_ROLE_KEY` (from `astro:env/server`) with `persistSession: false, autoRefreshToken: false`. This client **bypasses RLS**.

`grep_search` on the repository (implicit in the client-audit sub-agent) finds this module imported in **exactly one place** in `src/`:

- [src/pages/api/account/delete.ts:5](src/pages/api/account/delete.ts#L5) — used to run `auth.admin.deleteUser` and the post-delete orphan-verification query (out of scope for this change).

**Zero imports** of `supabase-admin` from any flashcards handler, from `src/lib/services/flashcard.service.ts`, or from `src/lib/services/review.service.ts`. All flashcards CRUD paths instantiate the anon client via `createClient(context.request.headers, context.cookies)` from [src/lib/supabase.ts:1-25](src/lib/supabase.ts#L1-L25), which is cookie-scoped to the caller's session.

Consequence: the "service-role client on the wrong path" failure mode that Risk #3 warns about is not present today on the flashcards CRUD surface. **This is a fact worth pinning with a low-cost lint/grep-style test or a test that would fail if a future change imports `supabase-admin` into a flashcards handler.** See Open Question OQ-3.

### 5. Test infrastructure available today (Phase 1 outputs)

- [vitest.config.ts:12-49](vitest.config.ts#L12-L49) — two Vitest projects: `unit` (Node env, `src/**/*.test.ts`) and `integration` (jsdom, `src/**/*.integration.test.{ts,tsx}` + `test/**/*.integration.test.{ts,tsx}`, 30 s timeout, `globalSetup` at `./test/setup/global-integration.ts`).
- [test/setup/global-integration.ts:14-64](test/setup/global-integration.ts#L14-L64) — reads `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY`; creates the anon client and a service-role admin client; seeds `test@integration.local` (idempotent — swallows `"User already registered"` / `"email_exists"`); signs it in; publishes its `user.id` on `process.env.TEST_SUPABASE_USER_ID`.
- [test/helpers/integration-user.ts:1-12](test/helpers/integration-user.ts#L1-L12) — exposes `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `getTestUserId()`.
- [test/smoke/integration-smoke.integration.test.ts:1-30](test/smoke/integration-smoke.integration.test.ts#L1-L30) — smoke test that queries `flashcards` via a service-role client to confirm the harness reaches Supabase.

What's missing for Risk #3:

- **A second seeded user.** Options: extend `global-integration.ts` to seed both a "primary" and "secondary" user, or add a per-test helper `createIntegrationUser(overrides)` that uses the admin client to make an ad-hoc user with a random suffix and returns a scoped anon client for it. The plan should pick one; either satisfies the risk.
- **A way to invoke the route handlers from a test.** The handlers are Astro API routes; the cheapest option is to import the exported `GET`/`POST`/`PUT`/`DELETE` and call them with a hand-rolled `APIContext`-shaped object (populating `request`, `cookies`, `params`, and `locals.user`). The next-cheapest is running the middleware too by using Astro's dev server or `astro:integration` test utilities. Given §7's "test-infrastructure tuning: minimal" rule, direct handler invocation with a fabricated context is preferred; middleware behaviour (401) can be asserted by directly importing `onRequest` from `src/middleware.ts` and running it against a mock context.
- **A pattern for issuing requests as user A vs user B.** With direct handler invocation, this reduces to: build the anon client for user A (via `auth.signInWithPassword`), pass it as `context.locals.user = { id: A.id, ... }`, and let the handler call `createClient(headers, cookies)`. That's the tricky part — the handler always re-creates its own client from headers/cookies, so tests need to route the correct auth cookies through the fabricated context. Alternative: **skip the handler-recreates-client wiring and set `context.locals.supabase` if it exists** — but the current handlers do NOT read `locals.supabase`; they always call `createClient(headers, cookies)`. See OQ-2.

### 6. Behavioural oracle — what each test must prove

Per test-plan §1 (oracle from sources, not implementation) and the risk description, the following are the assertions each integration test must make. Values are derived from the PRD access-control clause and the SQL contract, not from re-reading the handler:

| Endpoint | Setup | Action | Assertion (oracle) |
|---|---|---|---|
| `GET /api/flashcards` (unauth) | no session | GET | HTTP 401, JSON `{ error: "Unauthorized" }` |
| `GET /api/flashcards` (auth as A) | A owns 2 cards, B owns 3 cards | GET as A | HTTP 200; response `data` has length **exactly 2**; every element's `user_id === A.id`; no element's `id` matches any of B's card IDs |
| `POST /api/flashcards` (auth as A, body carries `user_id: B.id`) | Users A, B exist | POST as A with a body attempting to spoof `user_id` | HTTP 201 with `data.user_id === A.id` (the `user_id` field in body is dropped by Zod); DB row (verified via admin client) has `user_id = A.id` |
| `PUT /api/flashcards/[B's card id]` (auth as A) | B owns card `X`, A owns nothing | PUT as A with new `front`/`back` | HTTP **404** with `{ error: "Flashcard not found" }`; B's row in DB (verified via admin client) is **unchanged** (front/back/updated_at all match pre-test values) |
| `DELETE /api/flashcards/[B's card id]` (auth as A) | B owns card `X` | DELETE as A | HTTP **404**; B's row **still exists** in DB (verified via admin client SELECT by id returns 1 row) |
| `PUT /api/flashcards/[id]` (unauth) | any state | PUT with valid body | HTTP 401 from middleware; DB unchanged |
| `DELETE /api/flashcards/[id]` (unauth) | any state | DELETE | HTTP 401 from middleware; DB unchanged |

The 404-not-403 assertion is a **product contract** (anti-enumeration) — the test must lock in the specific status code, not just "any non-200".

### 7. Cost × signal decision

Per test-plan §1 principle 1 (cheapest test that gives real signal) and Risk #3 anti-patterns ("mocking Supabase kills the whole point"), the cheapest layer that catches this failure is:

- **Integration tests** against local Supabase, with two seeded users, invoking the exported route handlers with a fabricated `APIContext`, and asserting BOTH the HTTP response AND the final DB state (via the admin client, so post-conditions are not themselves clouded by RLS).

Unit tests over the service functions are **not sufficient** — mocking the Supabase client would let a bug that removes the RLS policy pass, because the mock has no notion of policies. Unit tests over the middleware alone are also not sufficient — the middleware only produces 401 on unauth, not the not-owner 404.

E2e is not needed: the failure mode is at the API boundary, not in the UI. §7 explicitly deprioritises e2e for MVP.

## Code References

- [src/middleware.ts:1-32](src/middleware.ts#L1-L32) — auth pre-gate; produces 401 for unauth requests to `/api/flashcards*` and `/api/account*`.
- [src/pages/api/flashcards/index.ts:11-52](src/pages/api/flashcards/index.ts#L11-L52) — GET and POST handlers.
- [src/pages/api/flashcards/[id].ts:21-90](src/pages/api/flashcards/[id].ts#L21-L90) — PUT and DELETE handlers; 404 on not-owner via service-layer `.eq("user_id", ...)`.
- [src/lib/services/flashcard.service.ts:14-76](src/lib/services/flashcard.service.ts#L14-L76) — `listFlashcards` (bare select, RLS-only), `createFlashcard` (INSERT with `user_id` from caller), `updateFlashcard` and `deleteFlashcard` (both `.eq("id", id).eq("user_id", userId)`).
- [src/lib/schemas/flashcard.schemas.ts:10-19](src/lib/schemas/flashcard.schemas.ts#L10-L19) — request-body Zod schemas; no `user_id` field, so body-spoofing is stripped by Zod's default object mode.
- [src/lib/supabase.ts:1-25](src/lib/supabase.ts#L1-L25) — anon/session-scoped client factory (all flashcards handlers).
- [src/lib/supabase-admin.ts:1-14](src/lib/supabase-admin.ts#L1-L14) — service-role client factory; **not imported by any flashcards handler**.
- [supabase/migrations/20260531120000_create_flashcards.sql:9,30-46](supabase/migrations/20260531120000_create_flashcards.sql#L9) — `user_id` FK, `enable row level security`, four per-command policies.
- [supabase/migrations/20260601120000_flashcards_fsrs.sql:10-21](supabase/migrations/20260601120000_flashcards_fsrs.sql#L10-L21) — FSRS state columns added to the same table (inherit the same RLS).
- [src/types.ts:1-18](src/types.ts#L1-L18) — `Flashcard` DTO used for response-shape assertions.
- [vitest.config.ts:12-49](vitest.config.ts#L12-L49) — unit + integration Vitest projects.
- [test/setup/global-integration.ts:14-64](test/setup/global-integration.ts#L14-L64) — global setup seeds one integration user; needs extension for a second user.
- [test/helpers/integration-user.ts:1-12](test/helpers/integration-user.ts#L1-L12) — helpers exposing test-user constants and ID.

## Architecture Insights

- **Belt-and-suspenders is deliberate.** Manual CRUD (S-01) started RLS-only; impl-review added `.eq("user_id", userId)` to write paths ([context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md](context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md)). Later features (S-02 review session) adopted the same "RLS for reads + `.eq` on writes" convention explicitly ([context/archive/2026-05-31-sr-review-session/plan.md](context/archive/2026-05-31-sr-review-session/plan.md)). This is a project convention — new CRUD-touching code should follow it and tests should enforce that BOTH layers are present for mutations, and that the READ path returns the empty-for-other-users answer via RLS.
- **The admin client is walled off in one file.** [src/lib/supabase-admin.ts:1-14](src/lib/supabase-admin.ts#L1-L14) is imported only by `src/pages/api/account/delete.ts`. The account-deletion plan ([context/archive/2026-06-24-account-deletion-gdpr/plan.md](context/archive/2026-06-24-account-deletion-gdpr/plan.md)) states this isolation is a privilege boundary decision. Tests for Risk #3 do not need to exercise the admin client (except for post-condition verification of DB state).
- **404 is the not-owner contract.** Every mutation returns "Flashcard not found" for a UUID that exists but isn't yours. This blocks id enumeration and is user-visible; tests must pin it precisely.
- **Middleware, not per-handler, is the auth pre-gate.** The auth check lives in `src/middleware.ts`. Handlers re-check as defense-in-depth. Tests should exercise the middleware path (via `onRequest`) at least once to prove the 401 contract, rather than only exercising handlers with a fabricated `locals.user = null`.

## Historical Context (from prior changes)

- [context/archive/2026-05-31-flashcard-schema-with-sr/plan.md:78-82](context/archive/2026-05-31-flashcard-schema-with-sr/plan.md#L78-L82) — original decision to use four per-command RLS policies with `auth.uid() = user_id`.
- [context/archive/2026-05-31-flashcard-schema-with-sr/plan.md:20](context/archive/2026-05-31-flashcard-schema-with-sr/plan.md#L20) — original decision that authenticated SDK code does NOT need manual `WHERE user_id = ?`; RLS enforces silently. This is why `listFlashcards` is a bare select.
- [context/archive/2026-05-31-manual-flashcard-crud/plan.md:19-20](context/archive/2026-05-31-manual-flashcard-crud/plan.md#L19-L20) — reaffirms anon-client-only usage for CRUD.
- [context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md:23-29](context/archive/2026-05-31-manual-flashcard-crud/reviews/impl-review.md#L23-L29) — the impl-review that added explicit `.eq("user_id", userId)` to `updateFlashcard` and `deleteFlashcard` as defense-in-depth.
- [context/archive/2026-05-31-manual-flashcard-crud/plan.md:32](context/archive/2026-05-31-manual-flashcard-crud/plan.md#L32) — cross-user RLS isolation was verified **manually** only; automated coverage was deferred to a future phase — which is exactly this change.
- [context/archive/2026-05-31-sr-review-session/plan.md:45](context/archive/2026-05-31-sr-review-session/plan.md#L45) — codifies the convention: "the review service trusts `auth.uid()` via RLS for reads and uses `.eq('user_id', userId)` defense-in-depth on writes, matching the existing service pattern."
- [context/archive/2026-06-23-ai-flashcard-generation/plan.md:44](context/archive/2026-06-23-ai-flashcard-generation/plan.md#L44) — AI-accepted cards flow through the existing anon-client CRUD path; no new authorization surface.
- [context/archive/2026-06-24-account-deletion-gdpr/plan.md:23-65](context/archive/2026-06-24-account-deletion-gdpr/plan.md#L23-L65) — introduced `src/lib/supabase-admin.ts`; explicitly documents that the service-role key is walled off (secret env, one module, one route).
- [context/foundation/lessons.md](context/foundation/lessons.md) — the "user-scoped tables must cascade + orphan-check" rule; relevant here only insofar as `flashcards` already complies (`on delete cascade` on the FK).

## Related Research

- [context/archive/2026-05-31-sr-review-session/research.md](context/archive/2026-05-31-sr-review-session/research.md) — earlier §4 discussed auth + RLS index strategy for the review query path. Adjacent scope; not a duplicate.
- No prior research artifact explicitly covers cross-user isolation *tests*; this document is the first.

## Open Questions

- **OQ-1: How does the integration test invoke Astro API handlers?** Two options: (a) direct import of the exported `GET`/`POST`/`PUT`/`DELETE` and hand-rolled `APIContext`; (b) spin up an Astro dev server or use `astro:testing` utilities. Option (a) is cheaper and matches §7's "test-infrastructure tuning: minimal"; option (b) exercises middleware naturally. Recommendation: (a) for handlers + a separate direct `onRequest` test for the middleware 401 contract. Plan phase must decide.
- **OQ-2: How does a fabricated `APIContext` deliver auth to `createClient(context.request.headers, context.cookies)`?** The handler always re-creates the Supabase client from request headers/cookies. A test that only sets `context.locals.user` will still get a *cookie-less* Supabase client inside the handler, so RLS will see `auth.uid() = null` — every query returns empty. Two ways out: (i) sign in a real anon-client user and pass its cookies via a mock `AstroCookies` implementation; (ii) refactor handlers to accept a preconstructed client from `context.locals` (bigger scope, invasive). Recommendation: (i); plan must produce or reuse a `signInUserAndBuildContext(user)` helper.
- **OQ-3: Should we pin the "no admin client in flashcards handlers" invariant with a structural test?** A `grep_search` or ESLint no-restricted-imports rule that fails if `supabase-admin` is imported from `src/pages/api/flashcards/**` or `src/lib/services/flashcard.service.ts` would catch a future accidental regression at build time — much cheaper than an integration test. Decide during planning.
- **OQ-4: Is a spoof-attempt test on `POST` valuable, given Zod strips extra keys and RLS `with_check` enforces `auth.uid() = user_id`?** The behaviour is already double-guarded. A single test asserting the created row's `user_id === A.id` (regardless of body) is cheap and gives real signal — it would fail if Zod's mode ever switched to passthrough OR if RLS were removed. Recommended.
- **OQ-5: Do we assert on `updated_at` non-change when a not-owner PUT is rejected?** The service returns before any DB mutation happens (0 rows matched `.eq("id", id).eq("user_id", userId)`), so `updated_at` should be untouched. Asserting on it locks in the "no side effect" guarantee. Recommended for the PUT-not-owner test.
