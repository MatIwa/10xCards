# Bootstrap Vitest + AI generation critical-path tests — Plan Brief

> Full plan: [context/changes/testing-ai-generation-critical-path/plan.md](./plan.md)
> Test plan (drives everything): [context/foundation/test-plan.md](../../foundation/test-plan.md)

## What & Why

Install Vitest, wire the first test infrastructure this project has ever had, and land two reference tests that lock in the top two risks from the test plan (§2): the AI-generation parser resilience (Risk #1) and the candidate accept/edit/reject → save fidelity (Risk #2). These two tests will also become the canonical "how do I add a unit test" and "how do I add an integration test" cookbook entries (§6.1, §6.2) that every future contributor — human or agent — reads first.

## Starting Point

No test runner is installed today ([package.json](../../../package.json) has no `test` script and no test deps). The AI generation service already returns typed errors on parse failure and the candidate-save component already tracks the accept/edit/reject state — the tests will lock these existing behaviors as contracts, not invent new ones. Local Supabase CLI is present as a devDependency; RLS on the `flashcards` table is granular per-operation.

## Desired End State

`npm test`, `npm run test:unit`, `npm run test:integration` are wired and green. Two reference tests exist and lock in the two highest-risk failure scenarios in the wedge feature. Cookbook §6.1 and §6.2 in [context/foundation/test-plan.md](../../foundation/test-plan.md) point at these two files with location, naming, run command, and one-line pattern. The team has the pattern (RTL + fetch-stub-to-real-handler + local Supabase) it needs for Phase 2 of the rollout.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test runner | Vitest, two projects (`unit`, `integration`) split by filename suffix | Vite-native (project already ships Vite via Astro/Tailwind); per-project environment avoids paying jsdom cost on every unit test | Test-plan §4 (Vitest pinned) + Plan question `VitestConfig` |
| OpenRouter mocking | `vi.stubGlobal('fetch', vi.fn())` with per-test `Response` objects | One provider, one URL, one method — MSW overhead is not justified at this scale; matches test-plan §1 cost×signal principle | Plan question `HttpMock` |
| Risk #2 test surface | Component-driven integration: RTL + jsdom drives the real `GenerateFlashcards.tsx`; `POST /api/flashcards` routes to the real handler; assertions read DB via service-role client | Only surface that catches the actual Risk #2 failure modes (wrong-subset persisted, dropped edits, bulk-action bugs) — those live in component state, not in POST bodies | Plan question `Risk2Surface` |
| Supabase harness | Assume Supabase running; verify via `supabase status` in globalSetup, seed test user once, truncate `flashcards` between tests | Cold start is 30–60s per run — unacceptable for the tight loop the cookbook targets; auto-start is not viable for CI-later either | Plan question `SupabaseHarness` |
| Test-user authentication | Real `signInWithPassword` session cookie injected into synthetic APIContext headers | RLS `flashcards_insert_own` requires `auth.uid() = user_id`; `locals.user` stub alone is not enough — same pattern Phase 2 will need for two-user RLS tests | Plan (from research on [src/lib/supabase.ts](../../../src/lib/supabase.ts) + [RLS migration](../../../supabase/migrations/20260531120000_create_flashcards.sql)) |
| Scope guard | No CI wiring, no coverage tool, no MSW, no post-edit hook, no Playwright | [context/foundation/test-plan.md §3 Phase 4](../../foundation/test-plan.md) holds CI until Phases 1–3 land; §7 explicitly deprioritizes AI-native layers and test-infra tuning at MVP scale | Test-plan §3, §7 |

## Scope

**In scope:**
- Vitest install, `vitest.config.ts` with `unit` + `integration` projects, `astro:env/server` mock, three npm scripts.
- Integration harness: `globalSetup` (Supabase-status check, seed test user), per-test truncate, session-cookie helper, fetch-stub-to-real-handler helper.
- Reference unit test for Risk #1 in [src/lib/services/ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts).
- Reference integration test for Risk #2 in [src/components/dashboard/GenerateFlashcards.integration.test.tsx](../../../src/components/dashboard/GenerateFlashcards.integration.test.tsx).
- Cookbook §6.1 and §6.2 updates in [context/foundation/test-plan.md](../../foundation/test-plan.md); §6.6 phase note.

**Out of scope:**
- CI wiring ([context/foundation/test-plan.md §3 Phase 4](../../foundation/test-plan.md) territory).
- Tests for Risks #3–#7 (Phases 2 and 3 of the rollout).
- Post-edit hooks, Playwright, visual snapshots, coverage reporters, custom watchers ([context/foundation/test-plan.md §7](../../foundation/test-plan.md)).
- Modifications to `.github/workflows/ci.yml`, `wrangler.jsonc`, or any deployment config.
- Flipping the test-plan §3 Phase 1 status row to `complete` — that is the `/10x-test-plan` orchestrator's job.

## Architecture / Approach

Two Vitest projects live in one config. Unit tests (`*.test.ts`) run in `node` with the AI-generation service's global `fetch` stubbed via `vi.stubGlobal`. Integration tests (`*.integration.test.tsx`) run in `jsdom`, render the real React component with `@testing-library/react`, and use a fetch stub that switches on `URL.pathname + method`: `/api/flashcards/generate` is faked outright (LLM path is covered by the unit test), and `POST /api/flashcards` is dynamically imported from [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts) and invoked with a synthetic Astro `APIContext` carrying the seeded test user's Supabase session cookie. Assertions read `flashcards` rows directly via a service-role client. Local Supabase is prerequisite — global setup verifies it's running and fails fast if not.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Bootstrap Vitest runner and shared harness | Vitest installed, `vitest.config.ts` with two projects, three npm scripts, integration `globalSetup` + helpers, one smoke test per project passing | `astro:env/server` virtual-module resolution in Vitest; local-Supabase precondition being unfriendly on first run |
| 2. Risk #1 — AI-generation parser reference unit test | 12 test cases covering every branch of `GenerateResult` in [ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts); cookbook §6.1 updated | Oracle-problem drift (fixtures accidentally copied from real LLM output instead of derived from schema) |
| 3. Risk #2 — candidate save reference integration test | One end-to-end test through the real component → real API route → local Supabase, asserting exact DB subset for the correct user; cookbook §6.2 + §6.6 updated | Getting the `@supabase/ssr` cookie shape right so RLS accepts the session; jsdom + `flushSync` interactions timing under `user-event` |

**Prerequisites:** Docker running; `npx supabase start` executed at least once; `TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY` exported from `supabase status` output; `npx supabase db reset` applied at least once so migrations are present.
**Estimated effort:** ~3 focused sessions across 3 phases.

## Open Risks & Assumptions

- **`@supabase/ssr` cookie format is not publicly documented as a spec.** Phase 3 pins it by observation from a real signed-in session; if @supabase/ssr changes the cookie shape in a future release, the helper breaks. Mitigation: the format is centralized in `test/helpers/supabase-session.ts` — one place to update.
- **Local Supabase must be up.** The harness fails fast with a clear message rather than trying to auto-start (per the accepted `SupabaseHarness` decision). Developers new to the repo will see this error on first `npm run test:integration` and need the AGENTS.md / cookbook §6.2 note.
- **Fetch-stub-to-real-handler pattern is our own convention.** No prior Astro-testing article documents it; the plan captures it in Critical Implementation Details and Phase 3's cookbook §6.2 entry so future contributors have a template.
- **Assumption: the seeded test user password is not a secret.** It only exists on local Supabase instances; it never reaches production. Committing it as a constant in `test/setup/global-integration.ts` is safe.

## Success Criteria (Summary)

- `npm test` exits 0 with two projects reporting green.
- A future contributor can read cookbook §6.1 and §6.2 and write a new unit or integration test for the next feature without asking a question.
- Deliberately breaking either the parser branch or the candidate-save subset persistence causes exactly the corresponding test to fail with a clear, risk-anchored assertion.
