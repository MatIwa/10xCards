# Bootstrap Vitest + AI generation critical-path tests — Implementation Plan

## Overview

Install Vitest, wire the first test infrastructure this project has ever had, and land two reference tests that lock in the two highest-risk failure scenarios named in [context/foundation/test-plan.md](../../foundation/test-plan.md) §2 (Risks #1 and #2). Every design decision is grounded in that guide — this plan implements Phase 1 of §3 and fills in cookbook §6.1 and §6.2 as each reference test lands.

## Current State Analysis

- **No test runner installed.** [package.json](../../../package.json) has `lint`, `format`, `build`, but no `test` script and no Vitest / Jest / RTL dependencies.
- **AI generation service already returns typed errors on parse failure.** [src/lib/services/ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts) catches `JSON.parse` and `modelOutputSchema.safeParse` failures, mapping both to `{ code: "invalid_model_output" }`. Timeouts and non-200 responses map to `provider_unavailable`; missing API key maps to `missing_api_key`; empty `cards` array maps to `empty_result`. The discriminated `GenerateResult` type is the test contract.
- **Zod contract lives in [src/lib/schemas/ai-generation.schemas.ts](../../../src/lib/schemas/ai-generation.schemas.ts).** `modelOutputSchema` validates `{ cards: [{ front, back }] }` with front ≤ 1000 chars and back ≤ 5000 chars, then `.transform((cards) => cards.slice(0, 15))`.
- **Candidate/save state lives entirely in one React island.** [src/components/dashboard/GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx) owns the accept/edit/reject state, `selectedIds` set, `bulkAction` progress, `originalFront/originalBack` tracking for `ai_full` vs `ai_edited` classification, and uses `flushSync` around setState to avoid stale closures during concurrent accepts. Accept posts one card at a time to `/api/flashcards`; reject is client-only (never hits the backend).
- **`POST /api/flashcards` uses the anon Supabase client.** [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts) → [src/lib/services/flashcard.service.ts](../../../src/lib/services/flashcard.service.ts). RLS policy `flashcards_insert_own` requires `auth.uid() = user_id`, so integration writes require a real authenticated session — not just a `locals.user` stub.
- **Supabase CLI already a devDependency** (v2.23.4). RLS on `flashcards` is granular per-operation. Migrations at [supabase/migrations/](../../../supabase/migrations/).
- **`astro:env/server` is a virtual module.** Consumed by [src/lib/services/ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts) (`OPENROUTER_API_KEY`) and [src/lib/supabase.ts](../../../src/lib/supabase.ts) (`SUPABASE_URL`, `SUPABASE_KEY`). Vitest cannot resolve it without help.
- **`SUPABASE_SERVICE_ROLE_KEY` already in the env schema** ([astro.config.mjs](../../../astro.config.mjs)). Tests can use it to seed users and to inspect DB state bypassing RLS during assertions.

## Desired End State

- `npm test`, `npm run test:unit`, and `npm run test:integration` are wired scripts and run green.
- `src/lib/services/ai-generation.service.test.ts` exists and covers every branch of `GenerateResult` — including the four ways `modelOutputSchema` can reject an OpenRouter response body — using `vi.stubGlobal('fetch', ...)`.
- `src/components/dashboard/GenerateFlashcards.integration.test.tsx` exists and drives the real component (RTL + jsdom) through a paste → generate → edit → reject → deselect → accept-selected sequence, asserting that local Supabase contains exactly the accepted subset with the correct `front`/`back`/`source` fields for the seeded test user.
- Cookbook §6.1 and §6.2 in [context/foundation/test-plan.md](../../foundation/test-plan.md) point at these two files with the location, naming, run command, and one-line pattern summary.

**Verification**: `npm test` exits 0. `npm run test:integration` requires a running local Supabase (per plan §5 SupabaseHarness decision); with Supabase down, it fails fast with a clear "Run `npx supabase start` first" message.

### Key Discoveries:

- The service already produces the exact error contract we want to lock in ([src/lib/services/ai-generation.service.ts:97-137](../../../src/lib/services/ai-generation.service.ts)); tests assert the contract, not the current implementation shape.
- The oracle-problem anti-pattern from [test-plan.md §2 Risk #1](../../foundation/test-plan.md) applies: test fixtures must be derived from the schema/PRD (front ≤ 1000, back ≤ 5000, ≥ 1 card), never copied from a real OpenRouter response.
- The component uses `flushSync` at multiple points ([GenerateFlashcards.tsx:291-303, 344-354](../../../src/components/dashboard/GenerateFlashcards.tsx)) — RTL + `@testing-library/user-event` handles this transparently as long as we `await` interactions.
- RLS enforcement means integration tests cannot just spoof `locals.user`; they need a real Supabase session cookie. This is the same infra Phase 2 will need for the two-user RLS test — get the pattern right now.

## What We're NOT Doing

- **Not wiring `npm test` into CI** — [context/foundation/test-plan.md §3 Phase 4](../../foundation/test-plan.md) explicitly holds CI enforcement until Phases 1–3 have produced a suite worth enforcing. The `.github/workflows/ci.yml` file stays untouched this phase.
- **Not adopting MSW, testcontainers, coverage reporters, custom watchers, or CI reporters.** [context/foundation/test-plan.md §7](../../foundation/test-plan.md) explicitly deprioritizes test-infrastructure tuning.
- **Not writing tests for Risks #3–#7.** Those are §3 Phases 2 and 3.
- **Not writing tests for pieces of `GenerateFlashcards.tsx` outside the accept/edit/reject state.** The `generate` HTTP flow is covered indirectly (the fetch stub for `/api/flashcards/generate`); its parser branches are covered by the Risk #1 unit test at the service layer.
- **Not adding a post-edit hook, Playwright, visual snapshots, or any AI-native layer.** [context/foundation/test-plan.md §7](../../foundation/test-plan.md).
- **Not testing FSRS fields.** The Risk #2 test creates cards via `POST /api/flashcards` which does not set FSRS state; the schema defaults handle it. FSRS wiring is Phase 3.
- **Not editing `.github/workflows/ci.yml`, `wrangler.jsonc`, or any deployment config.**
- **Not flipping the [context/foundation/test-plan.md §3 Phase 1](../../foundation/test-plan.md) row from `implementing` to `complete`** — that is the `/10x-test-plan` orchestrator's job, not this change's. This change updates cookbook §6.1, §6.2, and appends a §6.6 note.

## Implementation Approach

Three sequential phases, each independently verifiable.

Phase 1 lays the runner + shared harness with a smoke test in each project so the config is proven before real tests land. Phases 2 and 3 each add one reference test that establishes the pattern for its half of the cookbook, and each phase updates its cookbook section in the same commit so §6 never lies about what the reference is. All fetch mocking uses `vi.stubGlobal` per the test-plan §4 stack table.

## Critical Implementation Details

### `astro:env/server` module resolution

Vitest cannot resolve virtual Astro modules like `astro:env/server`. The shared setup file (`test/setup/env.ts`, loaded via `test.setupFiles` in [vitest.config.ts](../../../vitest.config.ts)) must call `vi.mock('astro:env/server', () => ({ OPENROUTER_API_KEY: '<test-key>', SUPABASE_URL: process.env.TEST_SUPABASE_URL, SUPABASE_KEY: process.env.TEST_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY }))` at the top level so any transitive import gets the stubbed exports. The `TEST_*` env vars come from `.dev.vars` or `supabase status` output; do NOT hard-code them.

### Component `fetch` calls must reach the real API route handler

The Risk #2 test renders `GenerateFlashcards` in jsdom, so there is no HTTP server on `/api/flashcards`. A test-scoped fetch stub matches on `URL.pathname + method` and:

- for `POST /api/flashcards/generate` → returns a synthetic `Response` with fabricated proposals (bypasses the LLM entirely; that path is covered by the Phase 2 unit test).
- for `POST /api/flashcards` → dynamically imports the real handler from [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts), constructs a minimal `APIContext`-shaped object (`request`, `cookies` via `AstroCookies`-compatible stub or `Astro.locals.user`, `locals`), invokes `POST(context)`, and returns the awaited `Response`. This inverts the browser boundary while keeping the route implementation as the actual system-under-test.

Without this stub, the component test either can't exercise real server behavior (defeating the point) or requires a full dev server (rejected under [context/foundation/test-plan.md §7](../../foundation/test-plan.md) simplicity guidance).

### Local Supabase test user + session cookies

The `flashcards_insert_own` RLS policy requires `auth.uid() = user_id`. `locals.user = { id: ... }` is not enough — `createClient(headers, cookies)` reads the actual session from cookies and RLS runs against that session. The integration harness must:

1. In `globalSetup`, seed a stable test user via the service-role client (`supabase.auth.admin.createUser({ email: 'test@integration.local', password: '<test-pw>', email_confirm: true })`); ignore the error if the user already exists (rerun-safe).
2. Before each integration test, sign that user in with the anon client (`signInWithPassword`) to obtain a fresh session.
3. Format the session as the `sb-<project-ref>-auth-token` cookie shape `@supabase/ssr` expects and inject it into the synthetic APIContext's `request.headers` (`Cookie: ...`) so the route's `createClient` picks it up.

This same infra is what Phase 2 (Risks #3, #4, #7 — RLS across endpoints, source-text non-retention, server-side validation) will need to seed two users. Getting the cookie-injection pattern right now avoids rework.

### Per-test truncate, not full DB reset

`supabase db reset` is called once in `globalSetup` (applies migrations, gives a clean slate); between tests, only the user-owned rows are truncated via the service-role client (`from('flashcards').delete().eq('user_id', TEST_USER_ID)`). Full `db reset` between tests is ~10x slower and unnecessary for isolation given the seeded user is stable.

## Phase 1: Bootstrap Vitest runner and shared harness

### Overview

Install dependencies, write the config, wire scripts, prove the two projects (`unit`, `integration`) run with one smoke test each. No real risk-coverage tests in this phase — just infrastructure.

### Changes Required:

#### 1. Test dependencies

**File**: [package.json](../../../package.json)

**Intent**: Add the minimal set of test devDependencies and three npm scripts. Nothing more (no coverage tool, no reporter, no watch script — `vitest --watch` is one keystroke on top of `npm test`).

**Contract**:
- Add devDependencies: `vitest`, `@vitest/ui` (optional local convenience — include only if trivial; skip if it adds transitive weight), `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@types/node` (if not already resolved via Astro's toolchain).
- Add scripts:
  - `"test": "vitest run"` — runs both projects, exits 0/1.
  - `"test:unit": "vitest run --project unit"`
  - `"test:integration": "vitest run --project integration"`
- Do NOT modify `lint-staged` or `husky` config in this phase.

#### 2. Vitest config with two projects

**File**: [vitest.config.ts](../../../vitest.config.ts) (new)

**Intent**: Define `unit` and `integration` as Vitest projects split by filename suffix so the two test kinds get the right environment and timeouts without cross-contamination.

**Contract**:
- Import `defineConfig` from `vitest/config`.
- `resolve.alias` for `@/*` → `./src/*` (mirror the tsconfig alias so tests use the same import syntax as production code).
- `test.projects`: two entries.
  - `unit`: `test.environment = 'node'`, `test.include = ['src/**/*.test.ts']` (excluding `*.integration.test.*`), `test.setupFiles = ['./test/setup/env.ts']`, default timeout.
  - `integration`: `test.environment = 'jsdom'`, `test.include = ['src/**/*.integration.test.{ts,tsx}']`, `test.setupFiles = ['./test/setup/env.ts', './test/setup/jest-dom.ts']`, `test.globalSetup = './test/setup/global-integration.ts'`, `test.testTimeout = 30000`.
- Do NOT set `test.globals = true`; keep imports explicit.

#### 3. Shared env setup

**File**: `test/setup/env.ts` (new)

**Intent**: Stub `astro:env/server` so any code importing it in either project resolves cleanly. Values are read from `process.env.TEST_*` so the integration project gets real Supabase URLs and the unit project gets whatever it needs.

**Contract**: A top-level `vi.mock('astro:env/server', () => ({ ... }))` returning the four env keys used by production code. For `TEST_SUPABASE_URL` etc., document expected env-var names in the file header comment; do not hard-code values.

#### 4. jest-dom matchers setup

**File**: `test/setup/jest-dom.ts` (new)

**Intent**: Import `@testing-library/jest-dom/vitest` so integration tests can use `toBeInTheDocument`, `toHaveTextContent`, etc.

**Contract**: One-line side-effect import; no exports.

#### 5. Global integration setup

**File**: `test/setup/global-integration.ts` (new)

**Intent**: Before the integration project runs, verify local Supabase is up, reset the DB once, seed the test user. Return a teardown fn (no-op — the test user is preserved for reruns).

**Contract**:
- Export `default async function setup()`.
- Read `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` from `process.env`; if any is missing, throw with the message: `"Integration tests require local Supabase. Run \`npx supabase start\` and export TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY. See test-plan §6.2."`
- Attempt `supabase.auth.admin.createUser({ email: 'test@integration.local', password: '<constant test password>', email_confirm: true })` via a service-role client. Ignore `'User already registered'` — rerun-safe.
- Store the resulting user id in a module the harness can import (e.g., `test/helpers/integration-user.ts` exporting `TEST_USER_ID` populated at setup time; or a `globalThis` handoff).
- Do NOT call `supabase db reset` on every run — it's destructive. Document in the file header that `npx supabase db reset` must have been run at least once to apply migrations, and that per-test cleanup uses truncate (see Phase 3).

#### 6. Smoke tests

**File**: `src/lib/utils.test.ts` (new) and `test/smoke/integration-smoke.integration.test.ts` (new)

**Intent**: Prove both projects execute end-to-end before any risk-coverage tests land. `src/lib/utils.test.ts` asserts something trivial on the existing `cn()` helper; the integration smoke test asserts the service-role client can `select 1` against local Supabase.

**Contract**: Two tests, each with a single `it()`. The integration smoke queries `select id from public.flashcards limit 1` (result may be empty; test asserts `error` is null).

### Success Criteria:

#### Automated Verification:

- Dependencies install: `npm install` succeeds.
- Config resolves: `npx vitest --project unit --list` and `npx vitest --project integration --list` both print the smoke tests.
- Unit smoke passes: `npm run test:unit`.
- Integration smoke passes: `npm run test:integration` (with local Supabase running).
- Combined script passes: `npm test`.
- Lint stays green: `npm run lint`.

#### Manual Verification:

- Running `npm run test:integration` with Supabase stopped produces the documented "Run `npx supabase start` first" error (not a stack trace).
- Test files are discoverable in the Vitest VS Code extension (if installed) — no config panic.

**Implementation Note**: After Phase 1 lands and automated verification passes, pause for manual confirmation before starting Phase 2.

---

## Phase 2: Risk #1 — AI-generation parser reference unit test

### Overview

Write the reference unit test for [context/foundation/test-plan.md §2 Risk #1](../../foundation/test-plan.md) — OpenRouter returns malformed / partial / schema-drifted JSON. The system under test is [src/lib/services/ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts); the boundary being mocked is global `fetch`. Update cookbook §6.1.

### Changes Required:

#### 1. Parser reference unit test

**File**: `src/lib/services/ai-generation.service.test.ts` (new)

**Intent**: Lock in the `GenerateResult` contract of `generateProposals()` against every failure branch the OpenRouter response can trigger, plus the happy path. Assertions target the discriminated union (`{ data, error: null }` vs `{ data: null, error: { code } }`), never the internal implementation.

**Contract**: One `describe('generateProposals')` block. Each test:

- Sets up `vi.stubGlobal('fetch', vi.fn())` in `beforeEach`; restores in `afterEach` (`vi.unstubAllGlobals()`).
- Constructs a `Response` object (with `Response.json(...)` or `new Response(body, { status })`) for the mock to return, then calls `await generateProposals('<200+ char source text>')`.

Required test cases (each is one `it()`):

- **happy path** — mock returns a valid `{ cards: [{ front, back }] }` body wrapped in the OpenRouter response envelope; assert `result.data` is a non-empty array of typed `Proposal`, each with a `crypto.randomUUID`-shaped id, matching the input front/back.
- **more than 15 cards** — mock returns 20 valid cards; assert `result.data.length === 15` (locks the `.slice(0, 15)` transform).
- **malformed JSON string in `content`** — `message.content = "not-json {["`; assert `error.code === 'invalid_model_output'`.
- **wrong shape (missing `cards`)** — `content = JSON.stringify({ items: [] })`; assert `error.code === 'invalid_model_output'`.
- **schema-drifted item (missing `back`)** — `content = JSON.stringify({ cards: [{ front: 'q' }] })`; assert `error.code === 'invalid_model_output'`.
- **`back` too long** — `content = JSON.stringify({ cards: [{ front: 'q', back: 'x'.repeat(5001) }] })`; assert `error.code === 'invalid_model_output'`.
- **empty `cards` array** — `content = JSON.stringify({ cards: [] })`; assert `error.code === 'empty_result'`.
- **non-string `content`** — `content = { cards: [] }` (already an object, not stringified); assert `error.code === 'invalid_model_output'`.
- **non-200 response** — mock returns `new Response('server error', { status: 502 })`; assert `error.code === 'provider_unavailable'`.
- **fetch throws AbortError** — mock throws `Object.assign(new DOMException('aborted', 'AbortError'), {})`; assert `error.code === 'provider_unavailable'` and the message includes "timed out".
- **fetch throws generic Error** — mock throws `new Error('network down')`; assert `error.code === 'provider_unavailable'`.
- **missing API key** — re-mock `astro:env/server` for this file to have `OPENROUTER_API_KEY: undefined`; assert `error.code === 'missing_api_key'` (fetch is not called).

Anti-patterns to avoid (from [context/foundation/test-plan.md §2 Risk #1](../../foundation/test-plan.md)):

- Do NOT copy fixtures from a real OpenRouter response. Every fixture is constructed inline from the schema.
- Do NOT assert on private implementation (e.g., specific timeout ms, whether the system prompt contains a certain string).
- Do NOT test through the API route — this is the service-layer contract test.

#### 2. Cookbook §6.1 update

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder in §6.1 with the actual reference: file path, naming convention, run command, and the one-line pattern.

**Contract**: The §6.1 body becomes something like:

- **Location**: colocated next to source — `src/**/*.test.ts` for unit tests.
- **Naming**: `<module-name>.test.ts`.
- **Run command**: `npm run test:unit` (or `npx vitest run <path>` for a single file).
- **Reference test**: `src/lib/services/ai-generation.service.test.ts`.
- **Pattern**: mock external HTTP boundaries with `vi.stubGlobal('fetch', vi.fn())`; construct fixture responses inline from the module's schema; assert on the module's typed return contract, never on internal implementation.

No other §6 sub-section changes in this phase.

### Success Criteria:

#### Automated Verification:

- New unit test passes: `npx vitest run src/lib/services/ai-generation.service.test.ts`.
- Full unit project passes: `npm run test:unit`.
- Lint stays green: `npm run lint`.
- Format stays green: `npx prettier --check "src/lib/services/ai-generation.service.test.ts" "context/foundation/test-plan.md"`.

#### Manual Verification:

- Cookbook §6.1 reads correctly and is enough for a future contributor to write their own unit test without asking questions.
- Deliberately breaking `generateProposals` (e.g., changing the empty-cards branch to return `{ data: [], error: null }`) causes the empty-result test to fail — proves the test locks the contract, not the current line-count.

**Implementation Note**: After Phase 2 lands and automated verification passes, pause for manual confirmation before starting Phase 3.

---

## Phase 3: Risk #2 — candidate save reference integration test

### Overview

Write the reference integration test for [context/foundation/test-plan.md §2 Risk #2](../../foundation/test-plan.md) — wrong subset persisted / edits dropped / bulk actions apply to hidden rows. The system under test is [src/components/dashboard/GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx) driven by real user interactions, going through the real `POST /api/flashcards` handler, hitting local Supabase, then asserting DB state. Update cookbook §6.2 and §6.6.

### Changes Required:

#### 1. Integration test harness helpers

**File**: `test/helpers/api-route-fetch-stub.ts` (new), `test/helpers/supabase-session.ts` (new), `test/helpers/db.ts` (new)

**Intent**: Package the three cross-cutting concerns so the integration test file reads like a scenario, not plumbing. All three will be reused by Phases 2 and 3 of the test rollout.

**Contract**:

- `api-route-fetch-stub.ts` — exports `installApiRouteFetchStub({ userId, sessionCookie, generateProposalsResponse })` which returns a `vi.fn()` suitable for `vi.stubGlobal('fetch', ...)`. The stub matches `URL.pathname + method`; for `POST /api/flashcards/generate` it returns the caller-supplied fabricated `proposals`; for `POST /api/flashcards` it dynamically imports the real handler and invokes it with a synthetic `APIContext`.
- `supabase-session.ts` — exports `signInTestUser()` which uses the anon client to sign in the seeded user and returns `{ userId, cookieHeader }` where `cookieHeader` is the `Cookie:` header value ready to inject into the synthetic APIContext's `request.headers`.
- `db.ts` — exports `resetFlashcards(userId)` (truncate via service-role client) and `readFlashcards(userId)` (returns all rows for that user, ordered by `created_at`).

Do NOT abstract further than these three helpers this phase; more abstraction will be justified by Phase 2 of the test rollout, not before.

#### 2. Candidate save reference integration test

**File**: `src/components/dashboard/GenerateFlashcards.integration.test.tsx` (new)

**Intent**: Prove that after a user selects a subset of AI-generated candidates, edits N of them, rejects some, and clicks "Accept selected", exactly that subset with those edits (and nothing else) exists in the `flashcards` table for the correct user.

**Contract**: One integration test file with a `beforeEach` that:

- Calls `resetFlashcards(TEST_USER_ID)`.
- Calls `signInTestUser()` to get a fresh session cookie.
- Installs the fetch stub with `generateProposalsResponse` = 5 fabricated proposals (front/back inline strings, each with a distinct marker like `"P1-front"`, `"P1-back"`, ..., `"P5-front"`).
- Renders `<GenerateFlashcards />` with RTL.

One `it('persists exactly the accepted subset with edits, and nothing else')` test that:

1. Types 300+ chars into the source-text textarea via `user-event`.
2. Clicks "Generate"; awaits proposals to render (find by role or by the marker `"P1-front"`).
3. Edits P1's front input from `"P1-front"` → `"P1-front-EDITED"`.
4. Clicks P2's individual "Reject" button (P2 is now gone from the list).
5. Unchecks P3's checkbox (P3 stays visible but is deselected).
6. Confirms P1, P4, P5 remain selected (P2 is gone; P3 is unchecked).
7. Clicks "Accept selected"; awaits the bulk action to complete (`bulkAction.kind === 'idle'` again — awaited via disappearance of the "Accepting" progress indicator).
8. Calls `readFlashcards(TEST_USER_ID)` and asserts:
   - Exactly 3 rows exist.
   - One row has `front === 'P1-front-EDITED'`, `back === 'P1-back'`, `source === 'ai_edited'`.
   - One row has `front === 'P4-front'`, `back === 'P4-back'`, `source === 'ai_full'`.
   - One row has `front === 'P5-front'`, `back === 'P5-back'`, `source === 'ai_full'`.
   - No row has `front === 'P2-front'` (rejected).
   - No row has `front === 'P3-front'` (deselected).
   - Every row has `user_id === TEST_USER_ID`.

Anti-patterns to avoid (from [context/foundation/test-plan.md §2 Risk #2](../../foundation/test-plan.md)):

- Do NOT snapshot the candidate list or assert on rendered class names / DOM structure.
- Do NOT test each toggle in isolation.
- Do NOT skip the DB-state assertion.
- Do NOT mock Supabase — the DB is the assertion target.

#### 3. Cookbook §6.2 and §6.6 update

**File**: [context/foundation/test-plan.md](../../foundation/test-plan.md)

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder in §6.2 with the actual reference, and append a §6.6 phase note capturing anything the rollout phase surfaced.

**Contract**: The §6.2 body becomes:

- **Location**: colocated next to the component / service — `src/**/*.integration.test.{ts,tsx}` for integration tests.
- **Naming**: `<component-or-service-name>.integration.test.tsx`.
- **Prerequisites**: local Supabase running (`npx supabase start`); `TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY` exported.
- **Run command**: `npm run test:integration` (or `npx vitest run --project integration <path>`).
- **Reference test**: `src/components/dashboard/GenerateFlashcards.integration.test.tsx`.
- **Helpers**: `test/helpers/api-route-fetch-stub.ts`, `test/helpers/supabase-session.ts`, `test/helpers/db.ts`.
- **Pattern**: RTL + jsdom drives the real component; a fetch stub matches on `URL.pathname + method` and routes API-route calls to the real handler with a synthetic APIContext that carries the seeded test user's Supabase session cookie; assert on DB state via a direct service-role query, never on rendered DOM.

The §6.6 phase note is 2–3 lines: what was surprising during rollout (e.g., "`@supabase/ssr` cookie format for `sb-<ref>-auth-token` required a specific base64 encoding — captured in `test/helpers/supabase-session.ts`.").

### Success Criteria:

#### Automated Verification:

- New integration test passes: `npx vitest run src/components/dashboard/GenerateFlashcards.integration.test.tsx`.
- Full integration project passes: `npm run test:integration`.
- Full suite passes: `npm test`.
- Lint stays green: `npm run lint`.
- Format stays green: `npx prettier --check "src/components/dashboard/GenerateFlashcards.integration.test.tsx" "test/helpers/**" "context/foundation/test-plan.md"`.

#### Manual Verification:

- Cookbook §6.2 reads correctly and is enough for a future contributor to write their own integration test.
- Deliberately breaking the component (e.g., making "Accept selected" also POST rejected cards) causes the test to fail with a clear assertion (extra rows in DB).
- Running the integration test with Supabase down produces the fail-fast message defined in `global-integration.ts`.
- Manually running the wedge flow in the browser after this phase still works — nothing in the test infra leaked into production behavior.

**Implementation Note**: After Phase 3 lands and automated verification passes, pause for manual confirmation. When confirmed, `/10x-test-plan` (re-invoked) will flip §3 Phase 1's status to `complete` and hand off to Phase 2 of the rollout.

---

## Testing Strategy

This change *is* the testing strategy. The tests it lands are the reference tests. No meta-tests-for-the-tests.

### Manual Testing Steps:

1. Fresh clone: `npm install`, `npx supabase start`, `npx supabase db reset`, export `TEST_*` env vars from `supabase status` output, `npm test`. All green.
2. Stop Supabase: `npx supabase stop`. Run `npm run test:integration`. Fails fast with the documented message.
3. Introduce a bug in `generateProposals` (e.g., swap `invalid_model_output` for `empty_result`). Run `npm run test:unit`. Expected: one test fails with a clear assertion.
4. Introduce a bug in `GenerateFlashcards` (e.g., make "Accept selected" also post rejected proposals). Run `npm run test:integration`. Expected: the row-count assertion fails.

## Performance Considerations

- Unit project should complete in < 2s locally.
- Integration project's first run does a `supabase db reset` once (~5–10s); subsequent runs skip it and complete in < 5s.
- Fetch-stub calls to the real API handler are synchronous imports; no extra network cost.

## Migration Notes

None. This change is additive: new files, three new npm scripts, no changes to existing production code.

## References

- Test plan (drives everything in this change): [context/foundation/test-plan.md](../../foundation/test-plan.md)
- AI generation service (SUT for Phase 2): [src/lib/services/ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts)
- AI generation schemas: [src/lib/schemas/ai-generation.schemas.ts](../../../src/lib/schemas/ai-generation.schemas.ts)
- Generate endpoint: [src/pages/api/flashcards/generate.ts](../../../src/pages/api/flashcards/generate.ts)
- Candidate/save component (SUT for Phase 3): [src/components/dashboard/GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx)
- Create flashcard endpoint (invoked in Phase 3 test): [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts)
- Flashcard service: [src/lib/services/flashcard.service.ts](../../../src/lib/services/flashcard.service.ts)
- Flashcards migration + RLS: [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql)
- Env schema: [astro.config.mjs](../../../astro.config.mjs)
- Similar prior implementation (AI generation feature): [context/archive/2026-06-23-ai-flashcard-generation/plan.md](../../archive/2026-06-23-ai-flashcard-generation/plan.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest runner and shared harness

#### Automated

- [x] 1.1 Dependencies install: `npm install` succeeds. — f0f7274
- [x] 1.2 Config resolves: `npx vitest --project unit --list` and `npx vitest --project integration --list` both print the smoke tests. — f0f7274
- [x] 1.3 Unit smoke passes: `npm run test:unit`. — f0f7274
- [x] 1.4 Integration smoke passes: `npm run test:integration` (with local Supabase running). — f0f7274
- [x] 1.5 Combined script passes: `npm test`. — f0f7274
- [x] 1.6 Lint stays green: `npm run lint`. — f0f7274

#### Manual

- [x] 1.7 Running `npm run test:integration` with Supabase stopped produces the documented "Run `npx supabase start` first" error (not a stack trace). — f0f7274
- [x] 1.8 Test files are discoverable in the Vitest VS Code extension (if installed) — no config panic. — f0f7274

### Phase 2: Risk #1 — AI-generation parser reference unit test

#### Automated

- [ ] 2.1 New unit test passes: `npx vitest run src/lib/services/ai-generation.service.test.ts`.
- [ ] 2.2 Full unit project passes: `npm run test:unit`.
- [ ] 2.3 Lint stays green: `npm run lint`.
- [ ] 2.4 Format stays green: `npx prettier --check "src/lib/services/ai-generation.service.test.ts" "context/foundation/test-plan.md"`.

#### Manual

- [ ] 2.5 Cookbook §6.1 reads correctly and is enough for a future contributor to write their own unit test without asking questions.
- [ ] 2.6 Deliberately breaking `generateProposals` (e.g., changing the empty-cards branch to return `{ data: [], error: null }`) causes the empty-result test to fail — proves the test locks the contract, not the current line-count.

### Phase 3: Risk #2 — candidate save reference integration test

#### Automated

- [ ] 3.1 New integration test passes: `npx vitest run src/components/dashboard/GenerateFlashcards.integration.test.tsx`.
- [ ] 3.2 Full integration project passes: `npm run test:integration`.
- [ ] 3.3 Full suite passes: `npm test`.
- [ ] 3.4 Lint stays green: `npm run lint`.
- [ ] 3.5 Format stays green: `npx prettier --check "src/components/dashboard/GenerateFlashcards.integration.test.tsx" "test/helpers/**" "context/foundation/test-plan.md"`.

#### Manual

- [ ] 3.6 Cookbook §6.2 reads correctly and is enough for a future contributor to write their own integration test.
- [ ] 3.7 Deliberately breaking the component (e.g., making "Accept selected" also POST rejected cards) causes the test to fail with a clear assertion (extra rows in DB).
- [ ] 3.8 Running the integration test with Supabase down produces the fail-fast message defined in `global-integration.ts`.
- [ ] 3.9 Manually running the wedge flow in the browser after this phase still works — nothing in the test infra leaked into production behavior.
