# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-01 (§3 Phase 1 opened)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` — 27 commits over the last 30 days (sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                 | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | OpenRouter returns malformed / partial / schema-drifted JSON; parser fails or feeds empty candidates back to the user; the AI generation wedge silently degrades                                                        | High   | High       | interview Q1 (direct concern), interview Q3 (generation flow low-confidence), hot-spot dir `src/lib/services/ — 7 commits/30d`, PRD §Success Criteria (75% acceptance depends on generation quality)                                                                                       |
| 2   | Candidate accept/edit/reject state tangled during save — wrong subset persisted, edits dropped, bulk actions apply to hidden rows → silent data loss on the wedge feature                                               | High   | High       | interview Q3 (deck-management flow low-confidence), hot-spot dir `src/components/dashboard/ — 10 commits/30d`, PRD FR-006, archive slice `2026-06-24-ux-improvements/plan.md` (bulk actions recently added)                                                                                |
| 3   | Cross-user data leak — RLS policy gap, service using service-role client on the wrong path, or a query missing an ownership predicate → user A reads or writes user B's cards or account state                          | High   | Medium     | PRD §Access Control ("each user's flashcards are private"), abuse/security lens: authorization/access (IDOR), hot-spot dir `src/lib/services/ — 7 commits/30d`, AGENTS.md hard rule ("Every new Supabase table must enable RLS immediately")                                               |
| 4   | Source text pasted for AI generation is retained after the request completes — leaks into a DB row, an error response body, or an operator-accessible log → PRD NFR + privacy contract breach, silent                   | High   | Medium     | PRD NFR ("Source text submitted for flashcard generation is not retained after the generation request completes — no trace in operator-accessible storage"), AGENTS.md hard rule ("Do not retain user source text after AI generation completes"), abuse/security lens: PII/secret leakage |
| 5   | Account deletion leaves orphan rows in a new user-scoped table — cascade OR orphan-check missed when a table is added → GDPR right-to-erasure breach; the endpoint may certify "complete erasure" while orphans persist | High   | Medium     | lessons.md rule ("User-scoped tables must cascade on `auth.users` delete AND be covered by the orphan-check"), PRD FR-014, hot-spot dir `src/lib/services/ — 7 commits/30d`                                                                                                                |
| 6   | FSRS wiring mistake — recall rating maps to the wrong next-due state, or the write-back targets the wrong card/user → PRD guardrail broken ("SR reviews must never lose progress or show the wrong card")               | High   | Medium     | PRD §Success Criteria guardrail + FR-011/012/013, interview Q3 (deck/review flow low-confidence), hot-spot dir `src/components/dashboard/ — 10 commits/30d`                                                                                                                                |
| 7   | Untrusted paste input reaches the LLM without server-side length / shape validation → cost blow-up on a single request, endpoint crash, or bypass of client-side Zod                                                    | Medium | Medium     | abuse/security lens: untrusted input + resource abuse, PRD Open Question 1 (input bounds undefined), hot-spot dir `src/pages/api/ — 3 commits/30d`                                                                                                                                         |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                   | Must challenge                                                                                                                                | Context `/10x-research` must ground                                                                                                                                       | Likely cheapest layer                                                                           | Anti-pattern to avoid                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1   | Given valid, malformed, and partial LLM response bodies, the generation endpoint either returns typed candidates or a user-safe error — never a 500 with the raw body, never an empty-success | "OpenRouter always returns the shape we asked for"; "Zod at the boundary is enough — we don't need to test the parse-failure branch"          | Where the LLM response is parsed, which Zod schema validates it, what the endpoint returns to the client on parse failure, what (if anything) is logged                   | integration (service + API route, provider mocked at the HTTP edge)                             | Oracle problem — fixture assertions copied from a real successful LLM call; test values must come from the schema/PRD, not the parser's current output |
| #2   | After a user selects a subset of candidates, edits N of them, and saves, exactly that subset with those edits (and nothing else) exists in the flashcards table for that user                 | "The list-state is my source of truth" — bulk actions and per-row edits mean multiple UI substates can disagree at save time                  | Which component owns candidate state, when accepted candidates become persisted rows, whether edits apply pre- or post-acceptance, whether rejected cards ever hit the DB | integration (form → API route → Supabase local)                                                 | Testing each toggle in isolation; snapshotting the candidate list; not asserting DB state after save                                                   |
| #3   | An authenticated user A cannot read, update, or delete a flashcard belonging to user B via any endpoint (list, detail, review, delete), regardless of RLS being "on"                          | "RLS enabled" ≠ "policy enforces ownership"; any code path using the service-role client bypasses RLS silently                                | Which endpoints use the anon client vs. the service-role client, which policies exist per table, whether every endpoint filters by `user_id` server-side                  | integration (two-user API test against local Supabase)                                          | Only asserting 200/403 on the happy path; testing with a single user; mocking Supabase (kills the whole point)                                         |
| #4   | On both success and error paths of `/api/flashcards/generate`, the pasted source text does not appear in any DB row, any log line, the error response body, or persistent observability       | "We never call `.insert()` with the source text" — exception handlers that echo the request body are the usual leak                           | Where the source-text variable flows, whether error handlers stringify request bodies, whether Cloudflare Worker tail logs capture request payloads                       | integration (happy + forced-error paths, assert on response body and DB state)                  | Only testing the happy path; not covering unexpected exceptions; not asserting on the error-body shape                                                 |
| #5   | Deleting an account leaves zero rows for that `user_id` in every user-scoped table; the endpoint returns 500 if a post-delete check finds orphans (existing behavior — test locks it in)      | "The FK cascade covers it" — the lesson explicitly requires BOTH cascade AND orphan-check; either alone silently regresses                    | Which tables carry `user_id` FKs, which have `on delete cascade`, which are enumerated in the orphan-check in the deletion service                                        | integration (create user + fixture rows in every user-scoped table → delete → assert zero rows) | Mocking the orphan-check step; only asserting endpoint 2xx; not seeding a fixture row in each user-scoped table                                        |
| #6   | Given a card with FSRS state X and a recall rating Y, the wiring calls ts-fsrs with (X, Y) and persists exactly the state ts-fsrs returned — unmodified — onto that card's row                | "We're just passing through the library, so nothing can break" — the wiring (which card, which state, which write, which user) is our surface | Where the FSRS state is read from the row, where the new state is written back, whether the write is scoped to the correct card and user                                  | unit (pure wiring) + one integration (round-trip through the API)                               | Asserting a specific next-due date (that tests ts-fsrs, not us); copying the library's calculation into the assertion (oracle problem)                 |
| #7   | A `POST /api/flashcards/generate` with too-short, too-long, wrong-type, or missing-field body is rejected with a 400 before the LLM is called                                                 | "The client validates" — the server must not trust client-side Zod; "the LLM will handle it" — the LLM is the cost you are trying to gate     | Where the request body is validated on the server, what bounds are enforced, whether the LLM call sits behind the validator                                               | unit (server-side Zod schema) + one integration (bad payloads → 400, no upstream call)          | Relying on OpenRouter to time out; testing only the happy-path payload; asserting on the client-side schema                                            |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                       | Goal (one line)                                                                                                                                                           | Risks covered | Test types         | Status       | Change folder                                          |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ------------ | ------------------------------------------------------ |
| 1   | Bootstrap runner + AI generation critical path   | Install Vitest, wire the first test infra, and prove Risks #1 and #2 at the cheapest layer that catches them                                                              | #1, #2        | unit + integration | implementing | `context/changes/testing-ai-generation-critical-path/` |
| 2   | Server-boundary contracts (auth, privacy, input) | Prove Risks #3, #4, #7 at the API-route boundary — RLS ownership across endpoints, source-text non-retention on success and error paths, and server-side input validation | #3, #4, #7    | integration + unit | not started  | —                                                      |
| 3   | Account deletion completeness + FSRS wiring      | Prove Risks #5 and #6 as durable regression tests — orphan-check enforcement across all user-scoped tables, FSRS state passthrough correctness                            | #5, #6        | integration + unit | not started  | —                                                      |
| 4   | Quality-gates wiring in CI                       | Enforce the suite as a required CI check on push/PR; only meaningful once phases 1–3 have produced a suite worth enforcing                                                | cross-cutting | gates              | not started  | —                                                      |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session.

| Layer                 | Tool                                | Version                                                    | Notes                                                                                                                                                |
| --------------------- | ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration    | Vitest                              | latest — see [package.json](package.json) after §3 Phase 1 | none yet — see §3 Phase 1 for runner bootstrap; picked over Jest because Vitest is Vite-native and the project already ships Vite via Astro/Tailwind |
| API mocking           | MSW (or a lightweight `fetch` mock) | to be pinned in §3 Phase 1                                 | mock only the OpenRouter HTTP edge; never mock internal services or Supabase calls                                                                   |
| Supabase test surface | `supabase` local CLI + test project | 2.23.4 (already a devDependency)                           | integration tests run against a locally-started Supabase instance; RLS tests need two seeded users                                                   |
| e2e                   | (optional) Playwright               | —                                                          | not adopted; only add if §3 Phase 2 finds a boundary integration cannot cover cheaply                                                                |
| accessibility         | none scoped                         | —                                                          | not in scope — see §7 (UI look-and-feel deliberately deprioritized)                                                                                  |
| AI-native             | none                                | —                                                          | deliberately skipped — see §7; interview Q5 explicitly warns against over-invested infrastructure                                                    |

**Stack grounding tools (current session):**

- Docs: Context7 skill available on-demand for Astro 6, React 19, Supabase JS, Vitest, ts-fsrs, Zod API references — invoke per rollout phase when the target framework/library detail matters; checked: 2026-07-01
- Search: `fetch_webpage` and `github_text_search` available for current tooling / status pages; Exa.ai not exposed in current session; checked: 2026-07-01
- Runtime/browser: Playwright-style browser tools available in-session (`open_browser_page`, `click_element`, `screenshot_page`) — noted only as a possibility for future e2e; not adopted for MVP given §7 negative-space rule; checked: 2026-07-01
- Provider/platform: no dedicated Supabase / Cloudflare / GitHub MCP in this session — use the CLIs (`supabase`, `wrangler`, `gh`) via terminal for provisioning and log inspection; checked: 2026-07-01

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that
rollout phase lands; before that, the gate is `planned`.

| Gate                                | Where                                       | Required?                                                                           | Catches                                                                      |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| lint (`npm run lint`)               | local pre-commit (husky + lint-staged) + CI | required (already wired — see [.github/workflows/ci.yml](.github/workflows/ci.yml)) | style + a11y + syntactic drift on `*.{ts,tsx,astro}`                         |
| build / typecheck (`npm run build`) | CI                                          | required (already wired)                                                            | type errors, Astro build regressions                                         |
| unit + integration (`npm test`)     | local + CI                                  | required after §3 Phase 4                                                           | logic regressions and boundary contracts (Risks #1–#7)                       |
| server-boundary integration         | CI                                          | required after §3 Phase 4                                                           | Risks #3, #4, #7 — regressions across RLS, privacy, input validation         |
| e2e on critical flows               | CI on PR                                    | optional                                                                            | reserved — adopt only if §3 Phase 2 finds an integration-untestable boundary |
| post-edit hook                      | local (agent loop)                          | optional                                                                            | deliberately deferred — Module 3 Lesson 3 territory; not this rollout        |
| visual diff / multimodal review     | CI on PR                                    | not adopted                                                                         | interview Q5 explicit: no UI look-and-feel testing                           |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: colocate unit tests next to source files with `src/**/*.test.ts`.
- **Naming**: `<module-name>.test.ts`.
- **Run command**: `npm run test:unit` for the unit project, or `npx vitest run <path>` for a single file.
- **Reference test**: `src/lib/services/ai-generation.service.test.ts`.
- **Pattern**: mock external HTTP boundaries with `vi.stubGlobal("fetch", vi.fn())`; construct provider responses inline from the module's schema/PRD oracle; assert on the typed return contract (`{ data, error }`), never on private implementation details.
- **Env mocks**: the global `astro:env/server` alias (`test/setup/astro-env-server.ts`, wired in `vitest.config.ts`) is the default — no per-test setup needed if you only read env values. When a test needs to mutate an env value per case (e.g., the "missing API key" branch in the reference test), use the `vi.hoisted` + getter pattern shown at the top of `ai-generation.service.test.ts`. Do not add a static `vi.mock("astro:env/server", ...)` inside test files — it duplicates the alias.

### 6.2 Adding an integration test (service + API route)

- **Location**: colocate integration tests next to the component or service with `src/**/*.integration.test.{ts,tsx}`.
- **Naming**: `<component-or-service-name>.integration.test.tsx` for React islands, or `.integration.test.ts` for non-React modules.
- **Prerequisites**: local Supabase running (`npx supabase start`) with `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` exported from the local status output.
- **Run command**: `npm run test:integration` for the integration project, or `npx vitest run --project integration <path>` for a single file.
- **Reference test**: `src/components/dashboard/GenerateFlashcards.integration.test.tsx`.
- **Helpers**: `test/helpers/api-route-fetch-stub.ts`, `test/helpers/supabase-session.ts`, `test/helpers/db.ts`.
- **Pattern**: RTL + jsdom drives the real component; a fetch stub matches app API calls by `URL.pathname + method`, routes `POST /api/flashcards` to the real Astro handler with a synthetic APIContext carrying the seeded user's Supabase session cookie, delegates Supabase network calls back to the original `fetch`, and asserts final DB state through a service-role query.

#### Two-user / N-user harness

- **Factory helper**: `test/helpers/integration-user.ts` exposes `createIntegrationUser()` for hermetic per-test users.
- **Direct route helper**: `test/helpers/invoke-api-route.ts` exposes `invokeApiRoute()` for calling Astro API handlers with explicit method, path, params, body, and session.
- **Admin post-check reader**: `test/helpers/db.ts` exposes `readFlashcardById()` for verifying final DB state without RLS filtering the assertion itself.
- **Reference test**: `test/rls/flashcards-cross-user.integration.test.ts`.
- **Pattern**: spin two hermetic users via `createIntegrationUser()`, invoke Astro handlers via `invokeApiRoute()` with the target user's cookies, assert on HTTP response AND on DB state via admin-client post-checks.

### 6.3 Adding a test for a new API endpoint

TBD — see §3 Phase 2 (server-boundary contracts phase will establish the canonical two-user RLS pattern, the source-text-leakage pattern, and the Zod-at-boundary pattern).

### 6.4 Adding a test for a new user-scoped table

TBD — see §3 Phase 3 (account-deletion phase will establish the orphan-check fixture pattern; every new user-scoped table thereafter reuses it, per the lessons.md rule).

### 6.5 Adding a test for FSRS / review-scheduling wiring

TBD — see §3 Phase 3 (FSRS wiring phase will establish the pattern: assert the call to ts-fsrs and the persisted state, never the specific next-due date).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note here capturing anything surprising the rollout phase taught — e.g., "Phase 1 chose Vitest workspace mode because Astro's Vite plugin conflicts with a flat config.")

Phase 1 reference tests exposed two harness details worth keeping: dynamic API-route imports need a Vitest alias for `astro:env/server`, and route-level fetch stubs must delegate non-app requests to the original `fetch` so Supabase REST calls remain real. The `@supabase/ssr` cookie value uses the `sb-<project-ref>-auth-token` key with a `base64-` encoded session JSON, captured in `test/helpers/supabase-session.ts`.

The API-route fetch stub (`test/helpers/api-route-fetch-stub.ts`) implements the full `APIContext["cookies"]` surface (`get`, `getAll`, `has`, `set`, `delete`, `merge`, `headers`) — not just `set` — so any future route that reads cookies before creating the Supabase client (e.g., `cookies.get("sb-...-auth-token")`) works out of the box. Reads are backed by the session cookie the test already puts in the request header; writes are no-ops because we do not exercise token refresh in tests.

**Phase 2 (Risk #3):** Direct `APIContext` fabrication is cheap; the `AstroCookies` sink only needs `.get`/`.getAll`/`.has` populated from the request `Cookie` header — writes are no-ops. ESLint `no-restricted-imports` with file-scoped overrides gave us an edit-time regression net over the admin-client surface at zero runtime cost.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI look-and-feel (visual snapshots, class-name assertions, marketing/landing pages)** — rejected as noise: they break constantly and catch nothing. Re-evaluate if a critical rendering regression ships to prod. (Source: Phase 2 interview Q5.)
- **Test-infrastructure tuning (custom runners, coverage thresholds, elaborate reporters)** — deliberately kept minimal. Re-evaluate if the suite grows past ~50 tests and speed/reporting friction becomes measurable. (Source: Phase 2 interview Q5.)
- **AI-native layers (post-edit hooks, vision-review passes, screenshot diffs)** — over-investment for MVP scale; a Zod parser test gives the same signal as a vision review over the generation flow, at ~1% of the cost. Re-evaluate once the classic suite is stable and the team has a specific failure mode a classic test cannot catch cheaply. (Source: Phase 2 interview Q5 + cost × signal principle.)
- **Third-party library internals (ts-fsrs scheduling math, shadcn/ui primitives, Supabase SDK, Astro renderer)** — the library is the test; only our wiring to it matters. Re-evaluate if we ever fork or wrap the library non-trivially. (Source: derived from Q5 spirit; also §1 principle #1.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-01
- Stack versions last verified: 2026-07-01
- AI-native tool references last verified: 2026-07-01 (none adopted — see §7)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
