# Generate endpoint — privacy + input validation tests (Risks #4 & #7) Implementation Plan

## Overview

Ship the second slice of test-plan §3 rollout Phase 2: a route-level integration test file that locks two contracts on `POST /api/flashcards/generate` — source-text non-retention (Risk #4) and server-side input validation before the LLM call (Risk #7). Reuses the harness established by `testing-rls-cross-user-access/` (Risk #3). No production code changes.

## Current State Analysis

- Endpoint at [src/pages/api/flashcards/generate.ts](src/pages/api/flashcards/generate.ts) is clean today: validation runs at [L46-L49](src/pages/api/flashcards/generate.ts) strictly before the LLM call at [L51](src/pages/api/flashcards/generate.ts); every error path returns a hardcoded message; the sole `console.error` emits only an error constructor name; the service never persists `source_text`.
- Zod v4.4.3 runtime probe confirmed that `parsed.error.issues` for `invalid_type` / `too_small` / `too_big` / missing-field / non-object does not include the raw input value — only type names and constraint metadata. See research §"Zod v4 issue shape at runtime".
- No test currently exercises the route boundary — the existing service-level test in [src/lib/services/ai-generation.service.test.ts](src/lib/services/ai-generation.service.test.ts) mocks `fetch` around the service in isolation, and the component-level test in [src/components/dashboard/GenerateFlashcards.integration.test.tsx](src/components/dashboard/GenerateFlashcards.integration.test.tsx) uses a canned fetch stub for `/api/flashcards/generate`, bypassing the real handler.
- Harness ready to reuse: [`invokeApiRoute`](test/helpers/invoke-api-route.ts), [`createIntegrationUser`](test/helpers/integration-user.ts), [`resetFlashcards` / `readFlashcards`](test/helpers/db.ts). Vitest `integration` project already wired for API-route imports (`astro:env/server` alias present).

## Desired End State

A single new integration test file — `test/api/generate-privacy-and-input.integration.test.ts` — passing under `npm run test:integration`, that:

- Asserts a `POST` with too-short / too-long / wrong-type / missing / non-object body returns 400 **and** the stubbed OpenRouter `fetch` was never called (Risk #7).
- Asserts that on every resolved-response branch (200 / 400 / 401 / 500 / 502), a UUID probe embedded in `source_text` does not appear in the response body, does not appear in any captured `console.error` argument, and does not appear in any row of the `flashcards` table for the seeded user (Risk #4).
- Locks the current `.strip()` behavior for unknown keys with one dedicated case.
- Updates `context/foundation/test-plan.md` §3 to mark Risks #4 and #7 as covered and §6 with a short cookbook entry pointing at the new file.

Verify with: `npm run test:integration -- generate-privacy-and-input`.

### Key Discoveries

- Route-boundary contract is pure request→response — no DB writes originate from the endpoint, so most cases need no seeded user; a single seeded user is used only for the `readFlashcards(userId).length === 0` post-check (research §"Cheapest useful test layer").
- The `envMock` + `vi.hoisted` + `vi.stubGlobal("fetch", vi.fn())` pattern from [ai-generation.service.test.ts:3-11](src/lib/services/ai-generation.service.test.ts) is the canonical way to control `OPENROUTER_API_KEY` and the outbound LLM call — reuse verbatim.
- `invokeApiRoute` synthesizes `context.locals.user` from `session.userId` at [invoke-api-route.ts:64-66](test/helpers/invoke-api-route.ts) without hitting Supabase, so 401 (no session) and validation-failure cases need no auth setup beyond passing/omitting `session`.
- Oracle rule: the test must assert on **negative properties** (probe absent from body, DB, logs) and **status codes** — never on the specific error strings from the current code, or the test becomes a mirror (research §"Architecture Insights").

## What We're NOT Doing

- Not testing `/api/flashcards` (save endpoint) — covered by the RLS slice.
- Not adding coverage for Risks #1, #2, #3, #5, #6 — different rollout phases / already shipped.
- Not adding a dedicated test for the top-level `catch` (`generate_route_unexpected`) — it is unreachable from currently-controllable stubs without fragile mocking; the `console.error` probe-token spy across all provoked branches proves the observable privacy property (research Open Question B).
- Not using MSW / Playwright — `vi.stubGlobal("fetch")` is the project's established pattern; a browser-level test cannot inspect `console.error` argument shape at the fidelity needed.
- Not writing production code. If a test reveals a leak, that becomes a separate change.
- Not enforcing `.strict()` on the schema — one test locks current `.strip()` behavior so a future flip becomes visible.

## Implementation Approach

Add one new test file under a new `test/api/` folder (matching the existing sibling `test/rls/`). Two `describe` blocks in one file so the harness setup (`beforeEach` / `afterEach` — seed user, reset flashcards, stub `fetch`, spy on `console.error`) is shared. Order the phases so the cheaper axis (validation, all synchronous, no LLM state) lands first and the probe-token oracle layer is added second on the same file. Cookbook update lands as Phase 3 once the code is proven green.

## Critical Implementation Details

- **Probe token shape.** Use `const probe = randomUUID()` inside each test that needs the oracle; embed as `"L".repeat(200 - probe.length) + probe` for valid-length bodies. For a too-short body, the probe must still be present — use `"a" + probe` (well under 200 chars, still contains the probe). Assert `expect(await response.text()).not.toContain(probe)` and iterate `console.error` mock calls with `JSON.stringify(call).includes(probe)`.
- **`fetch` stub ordering.** `vi.stubGlobal("fetch", vi.fn())` in the outer `beforeEach`; per-case `mockResolvedValueOnce` / `mockRejectedValueOnce` for the branches that reach the service. Cases that should never reach OpenRouter assert `expect(fetch).not.toHaveBeenCalled()`. Cases that force provider errors assert exactly one call.
- **`console.error` spy.** `const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})` in `beforeEach`; assert probe absence across `errorSpy.mock.calls` in every Risk #4 case. Restore via `vi.restoreAllMocks()` in `afterEach`.
- **DB post-check on every branch.** After every case, `expect((await readFlashcards(user.userId))).toHaveLength(0)`. Cheap, and locks the "generate never persists" invariant even if a future refactor adds a history/audit table.
- **Env-var mutation for missing-API-key case.** Follow the exact `vi.hoisted` + `vi.mock("astro:env/server", ...)` pattern from [ai-generation.service.test.ts:3-11](src/lib/services/ai-generation.service.test.ts); mutate `envMock.openrouterApiKey = undefined` and `vi.resetModules()` before the case, dynamic-import the route handler afterwards. Restore the key in `beforeEach`.

## Phase 1: Input validation contract (Risk #7)

### Overview

Create the new test file, wire the harness (seed user, reset DB, stub fetch, spy on console.error), and add the validation-boundary cases. All cases assert `status === 400` (or 200 for the strip case), no LLM `fetch` call (or exactly one for strip), and an empty DB post-check.

### Changes Required

#### 1. New folder for API-route integration tests

**File**: `test/api/` (new directory)

**Intent**: Mirror the existing `test/rls/` sibling so future route-level integration tests have a home; keeps `test/rls/` scoped to cross-user isolation and `test/api/` scoped to per-endpoint boundary contracts.

**Contract**: Directory only — no README required (test-plan §6 is the discovery surface).

#### 2. Test file scaffolding + input-validation cases

**File**: `test/api/generate-privacy-and-input.integration.test.ts`

**Intent**: Import the `POST` handler from `@/pages/api/flashcards/generate`, wire the harness (`createIntegrationUser` once per test, `resetFlashcards` before + after, `vi.stubGlobal("fetch", vi.fn())`, `vi.spyOn(console, "error")`, `envMock` mock for `astro:env/server`). Under `describe("input validation contract (Risk #7)")`, cover the enumerated bad-payload cases; each posts via `invokeApiRoute` with a valid session, asserts `response.status === 400`, `fetch` uncalled, DB empty. Include one accept-and-strip case that returns 200 (needs a canned success response on the fetch stub) and asserts stray keys were dropped from what the handler saw — the observable proof is `fetch` was called and the request that hit OpenRouter received only the parsed `source_text`; simplest assertion is `response.status === 200` plus DB still empty (endpoint never persists).

**Contract**: One test file, one top-level `describe("POST /api/flashcards/generate")` with two nested `describe` blocks (Phase 1 + Phase 2 add one each). Cases in this phase:

- missing field (`{}`)
- empty string (`{ source_text: "" }`)
- too short (`{ source_text: "a".repeat(199) }`)
- too long (`{ source_text: "a".repeat(25001) }`)
- wrong type (`{ source_text: 123 }`)
- non-object body (`"just a string"`)
- accept-and-strip (`{ source_text: valid, stray: "value" }` → 200, records the current `.strip()` behavior)

Each case follows: `const response = await invokeApiRoute({ method: "POST", pathname: "/api/flashcards/generate", body, session: { userId: user.userId, cookieHeader: "" }, handler: POST })` → `expect(response.status).toBe(400)` / `expect(fetch).not.toHaveBeenCalled()` / `expect(await readFlashcards(user.userId)).toHaveLength(0)`. The strip case sets `fetchMock.mockResolvedValueOnce(openRouterResponse(...))` and asserts 200 + `fetch` called once + DB still empty.

### Success Criteria

#### Automated Verification

- Test file exists at `test/api/generate-privacy-and-input.integration.test.ts`
- `npm run test:integration -- generate-privacy-and-input` passes all Phase 1 cases
- `npm run lint` passes
- `npx tsc --noEmit` (via `npm run build` or equivalent) passes

#### Manual Verification

- Grep the new file for the raw error strings from `generate.ts` (`"Validation failed"`, `"Invalid JSON body"`) — they must NOT appear as assertion values; the test asserts on status codes only, keeping the oracle grounded in the risk, not the code.
- Confirm no test in the phase re-implements the Zod schema's constants (no `200` / `25000` literals derived from the schema — those come from the risk's "too-short / too-long" language, which is fine, but the test must not import `generateFlashcardsSchema` and inspect its shape).

**Implementation Note**: After Phase 1 completes and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Privacy / non-retention contract (Risk #4)

### Overview

Add a second `describe("privacy / non-retention (Risk #4)")` block in the same file that layers the probe-token oracle across every response branch. Every case constructs a fresh `probe = randomUUID()`, embeds it in the `source_text`, and asserts probe absence from the response body, from every captured `console.error` argument, and from the `flashcards` table.

### Changes Required

#### 1. Extend the test file with probe-token cases

**File**: `test/api/generate-privacy-and-input.integration.test.ts`

**Intent**: Add cases covering every remaining resolved branch. Each case sets up its stub, embeds a UUID probe in the request body, invokes the handler, then runs three assertions in sequence: response text does not contain probe, no `console.error` call contains probe, DB has zero rows for the seeded user.

**Contract**: Cases in this phase:

- **401 no-session** — `invokeApiRoute` without `session`; body contains probe; expects `status === 401`.
- **400 too-short with probe** — reuses Phase-1 style with an embedded probe (short body: `"a" + probe`); expects `status === 400`; verifies the emitted `issues` shape does not echo the probe.
- **400 wrong-type with probe-shaped string as sibling key** — `{ source_text: 123, note: probe }` — locks that even with `.strip()` the probe never surfaces via `issues`.
- **502 provider non-ok** — `fetchMock.mockResolvedValueOnce(new Response("provider dump: " + probe, { status: 500 }))` on the outbound call; the response body from OpenRouter is discarded ([ai-generation.service.ts:104](src/lib/services/ai-generation.service.ts)); expects `status === 502`.
- **502 provider malformed JSON** — `fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }))`; expects `status === 502`, `code === "invalid_model_output"` shape verified only via `response.status`.
- **502 provider throws** — `fetchMock.mockRejectedValueOnce(Object.assign(new Error("boom " + probe), { name: "AbortError" }))`; expects `status === 502`.
- **500 missing API key** — mutate `envMock.openrouterApiKey = undefined`, `vi.resetModules()`, dynamic-import `{ POST }` inside the case, invoke; expects `status === 500`.
- **200 happy path** — `fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "F", back: "B" }])))`; expects `status === 200`, response body contains `"F"` and `"B"` but never the probe.

Each case ends with the three probe-absence assertions above. Reuse the `openRouterResponse` / `modelContent` helpers from the service test's pattern (copy-paste into this file — service test is not a public helper).

### Success Criteria

#### Automated Verification

- `npm run test:integration -- generate-privacy-and-input` passes all Phase 1 + Phase 2 cases
- `npm run lint` passes
- No test asserts on any specific error string; only status codes and probe-absence

#### Manual Verification

- Verify the assertion helper (or inline loop) iterates every `errorSpy.mock.calls[i]` — a bug that only checks the last call would let a leak slip through.
- Verify the DB post-check runs on every case, not only failure cases — a future refactor persisting on the happy path must fail the test.
- Confirm no case reads the response as JSON and asserts on `body.issues.length` or `body.issues[0].code` — the oracle is probe absence, not Zod's issue shape.

**Implementation Note**: After Phase 2 completes and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Test-plan §3 status update + §6 cookbook entry

### Overview

Reflect the shipped slice in `context/foundation/test-plan.md`: mark Risks #4 and #7 as covered in the §3 rollout row and fill §6.3 with the canonical pattern this file establishes.

### Changes Required

#### 1. §3 rollout row for Phase 2

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Status/change-folder cell for Phase 2 to reflect that all three Phase-2 risks (#3, #4, #7) have now shipped; the row transitions from `implementing` to `complete` once the CI gate confirms both the RLS slice and this slice are green.

**Contract**: Edit the Phase 2 row: Status column becomes `complete`; change-folder cell becomes `Risk #3 via testing-rls-cross-user-access/; Risks #4 + #7 via testing-generate-privacy-and-input/`.

#### 2. §6.3 cookbook — "Adding a test for a new API endpoint"

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the current `TBD` placeholder with the canonical pattern this slice establishes: route-level integration via `invokeApiRoute`, `vi.stubGlobal("fetch", vi.fn())` for the outbound edge, probe-token oracle for privacy-adjacent endpoints, DB post-check via `readFlashcards`, `console.error` spy for log-leak assertions.

**Contract**: 8–12 lines in §6.3 covering: file location convention (`test/api/`), imports (`invokeApiRoute`, `createIntegrationUser`, `resetFlashcards`, `readFlashcards`), `beforeEach`/`afterEach` skeleton, fetch-stub pattern, probe-token oracle when the endpoint handles user-submitted content, DB-empty post-check when the endpoint should not persist, reference to `test/api/generate-privacy-and-input.integration.test.ts` as the working example.

#### 3. §6.6 per-phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Append a 2–3 line note capturing what this slice taught: Zod v4 issue shape is safe for the current schema but the response body remains a live leak surface; probe-token oracle plus `.not.toContain` is the cheapest way to keep it locked; DB post-check on the happy path is what caught the "endpoint never persists" invariant.

**Contract**: One new paragraph under §6.6, adjacent to the existing Phase 2 note.

### Success Criteria

#### Automated Verification

- `context/foundation/test-plan.md` §3 Phase 2 row status reads `complete`
- §6.3 no longer contains `TBD`
- Markdown lint (if wired) passes; if not, `npm run lint` still passes (no code changes here)

#### Manual Verification

- Read §6.3 top-to-bottom — a new contributor with no context should be able to write a route-boundary test for a different endpoint from it.
- Confirm §6.6 note is factual and short; no marketing-tone summaries.

**Implementation Note**: After Phase 3 completes, mark the change ready for archive.

---

## Testing Strategy

### Unit Tests

- None added. The Zod schema is exercised transitively through the route boundary; a separate unit test on `generateFlashcardsSchema` in isolation would repeat what the route test already proves (research §"Response-guidance verification", Risk #7 row).

### Integration Tests

- All cases enumerated in Phases 1 and 2 above. One file, two `describe` blocks, ~15 cases total.
- Runs under the existing `integration` Vitest project; no new project or config needed.

### Manual Testing Steps

1. Run `npm run test:integration -- generate-privacy-and-input` and confirm all cases pass.
2. Temporarily edit `generate.ts` to add `console.error("debug", { body: await context.request.clone().text() })` before the return; re-run — the Risk #4 cases must fail. Revert.
3. Temporarily edit `generate.ts` to move `generateProposals(...)` above the `safeParse` gate; re-run — the Risk #7 cases must fail (fetch called on a bad payload). Revert.
4. Temporarily edit `generate.ts` to insert into `flashcards` on success; re-run — the DB post-check on the happy path must fail. Revert.

## Performance Considerations

- Each test creates one Supabase auth user via the admin API; on ~15 cases this is the dominant cost. If the run gets slow, hoist the user to a `beforeAll` and rely on `resetFlashcards` between cases — but only if a measured problem appears. Current expectation: file runs under 20s locally.

## Migration Notes

- Not applicable — test-only change.

## References

- Research: `context/changes/testing-generate-privacy-and-input/research.md`
- Sibling slice (harness authority): `context/changes/testing-rls-cross-user-access/plan.md`
- Reference test structure: `test/rls/flashcards-cross-user.integration.test.ts`
- Fetch-stub + env-mock pattern: `src/lib/services/ai-generation.service.test.ts:3-11,37-43`
- Endpoint under test: `src/pages/api/flashcards/generate.ts`
- Test plan risk source: `context/foundation/test-plan.md` §2 rows #4 and #7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Input validation contract (Risk #7)

#### Automated

- [x] 1.1 Test file exists at `test/api/generate-privacy-and-input.integration.test.ts`
- [x] 1.2 `npm run test:integration -- generate-privacy-and-input` passes all Phase 1 cases
- [x] 1.3 `npm run lint` passes
- [x] 1.4 TypeScript check passes

#### Manual

- [x] 1.5 No raw error strings from `generate.ts` used as assertion values
- [x] 1.6 Test does not import `generateFlashcardsSchema` to inspect its shape

### Phase 2: Privacy / non-retention contract (Risk #4)

#### Automated

- [x] 2.1 `npm run test:integration -- generate-privacy-and-input` passes all Phase 1 + Phase 2 cases
- [x] 2.2 `npm run lint` passes
- [x] 2.3 No test asserts on any specific error string; only status codes and probe-absence

#### Manual

- [x] 2.4 Probe-absence assertion iterates every `console.error` call
- [x] 2.5 DB post-check runs on every case (success and failure)
- [x] 2.6 No case asserts on `body.issues` shape

### Phase 3: Test-plan §3 status update + §6 cookbook entry

#### Automated

- [x] 3.1 §3 Phase 2 row status reads `complete`
- [x] 3.2 §6.3 no longer contains `TBD`
- [x] 3.3 `npm run lint` still passes

#### Manual

- [x] 3.4 §6.3 is self-sufficient for a new contributor writing a route-boundary test
- [x] 3.5 §6.6 note is factual and short
