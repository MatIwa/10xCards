# Generate endpoint — privacy + input validation tests — Plan Brief

> Full plan: `context/changes/testing-generate-privacy-and-input/plan.md`
> Research: `context/changes/testing-generate-privacy-and-input/research.md`

## What & Why

Ship the remaining slice of test-plan §3 rollout Phase 2: lock two contracts on `POST /api/flashcards/generate` — the pasted source text is never persisted, logged, or echoed back on any response branch (Risk #4), and payloads that violate length/shape are rejected with a 400 before the LLM is called (Risk #7). Both risks are real per the PRD and AGENTS.md hard rules; neither has any test coverage today.

## Starting Point

The endpoint is clean by construction — validation runs before the LLM call, error messages are hardcoded, and the service never persists `source_text` (research audit of every branch). But nothing locks these properties: a future edit adding a debug log, a `.refine()` echoing input, or a "just let the LLM handle it" refactor would ship silently. The RLS slice (`testing-rls-cross-user-access/`) already established `invokeApiRoute`, `createIntegrationUser`, `readFlashcards`, and the Vitest `integration` project — this slice reuses that harness plus the `vi.stubGlobal("fetch", vi.fn())` pattern from the service unit test.

## Desired End State

One new file `test/api/generate-privacy-and-input.integration.test.ts` under `npm run test:integration` locks both contracts across every response branch (200 / 400 / 401 / 500 / 502) via a UUID probe-token oracle and a stubbed OpenRouter `fetch`. `context/foundation/test-plan.md` §3 marks Phase 2 complete and §6.3 fills the TBD cookbook entry with the canonical route-boundary pattern.

## Key Decisions Made

| Decision                              | Choice                                                                      | Why (1 sentence)                                                                                                | Source   |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| Test layer                            | Route-level integration via `invokeApiRoute` + `vi.stubGlobal("fetch")`     | Endpoint contract is pure request→response; browser-level tests can't inspect `console.error` argument shape.   | Research |
| Oracle                                | UUID probe embedded in `source_text` + assert on negative properties        | Grounds the test in the risk ("source text absent"), not in the current error strings — avoids mirror-testing.  | Research |
| Unknown-keys case                     | Lock the current `.strip()` behavior with one dedicated test                | Cheap; a future `.strict()` flip becomes a visible failing test rather than a silent behavior change.           | Plan     |
| Top-level `catch` branch              | Skip a dedicated case; rely on `console.error` spy across all other cases   | The branch is unreachable from currently-controllable stubs without fragile mocking; property is what matters.  | Plan     |
| DB post-check scope                   | `readFlashcards(userId).length === 0` on every case (success + failure)     | Locks "generate never persists" against any future refactor that adds history/audit rows.                       | Plan     |
| 401 branch inclusion                  | One case: no session → 401, probe absent from response                      | Closes the privacy axis for the pre-auth branch at ~4 lines; RLS slice doesn't cover this endpoint's 401 body.  | Plan     |
| Separate unit test on the Zod schema  | No — route test covers it transitively                                      | A schema-in-isolation test would repeat what the route test proves (research §"Response-guidance verification"). | Research |

## Scope

**In scope:**

- `test/api/generate-privacy-and-input.integration.test.ts` covering all enumerated cases across Risks #4 and #7
- `context/foundation/test-plan.md` §3 status update and §6.3 cookbook fill-in

**Out of scope:**

- Any production code change to `generate.ts`, the service, or the schema
- Coverage for Risks #1, #2, #3 (shipped elsewhere), #5, #6 (Phase 3)
- MSW, Playwright, or e2e — the route boundary is the right and cheapest layer
- CI gate wiring — that's rollout Phase 4

## Architecture / Approach

Single file, two nested `describe` blocks (validation contract → privacy contract) sharing a `beforeEach` that seeds a Supabase user, resets flashcards, stubs global `fetch`, spies on `console.error`, and mocks `astro:env/server`. Each case invokes the real `POST` handler via `invokeApiRoute` with a synthesized session, then runs the three assertions: response body / captured `console.error` args / DB rows all free of the probe token. Cases that must not reach the LLM assert `expect(fetch).not.toHaveBeenCalled()`; cases that force provider errors set `fetchMock.mockResolvedValueOnce(...)` or `mockRejectedValueOnce(...)`. Missing-API-key case uses the `envMock` + `vi.resetModules()` pattern from the existing service unit test.

## Phases at a Glance

| Phase                                            | What it delivers                                                              | Key risk                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Input validation contract (Risk #7)           | Test file + harness + 7 cases asserting 400 before LLM (plus one strip case)  | Accidentally asserting on error strings turns the test into a mirror                |
| 2. Privacy / non-retention contract (Risk #4)    | Probe-token oracle applied across 8 branches (401 / 400 / 502 ×3 / 500 / 200) | Missing a `console.error` call in the assertion loop lets a leak slip through       |
| 3. Test-plan §3 status + §6 cookbook entry       | Rollout row → `complete`; §6.3 canonical pattern documented                   | Copy-pasting plan prose into §6.3 instead of writing the reusable pattern           |

**Prerequisites:** Local Supabase running (`npx supabase start`), `.dev.vars` populated with `TEST_SUPABASE_*` env vars (already used by the RLS slice — no new setup).

**Estimated effort:** One focused session across three phases; ~15 test cases in one file plus a small `test-plan.md` edit.

## Open Risks & Assumptions

- Zod v4's runtime issue shape for the current schema was probed clean, but a future Zod major upgrade or a `.strict()` / `.refine()` change could introduce a new leak vector — the probe-token oracle catches this, but only if new failure branches are added to the test whenever new branches are added to the schema.
- The DB post-check assumes `flashcards` remains the only user-scoped table the generate endpoint could plausibly write to; if a future "generation history" table is added, the assertion must be extended.

## Success Criteria (Summary)

- Directly POSTing bad payloads to `/api/flashcards/generate` returns 400 and never bills OpenRouter, verified in CI.
- No leaked source text ever appears in a response body, a log line, or a DB row, on any branch of the endpoint — verified by a probe-token oracle across the full response matrix.
- A new contributor can read `test-plan.md` §6.3 and write a route-boundary test for a different endpoint without opening this file.
