---
date: 2026-07-09T00:00:00Z
researcher: GitHub Copilot
git_commit: f669113482839dac1b4e83620acdbbe3dc591101
branch: master
repository: MatIwa/10xCards
topic: "Ground Phase 2 test-plan slice: source-text non-retention (Risk #4) and server-side input validation (Risk #7) on POST /api/flashcards/generate"
tags: [research, testing, risk-4, risk-7, generate-endpoint, privacy, input-validation, zod-v4]
status: complete
last_updated: 2026-07-09
last_updated_by: GitHub Copilot
---

# Research: Ground Phase 2 test-plan slice — Risks #4 and #7 on `POST /api/flashcards/generate`

**Date**: 2026-07-09
**Researcher**: GitHub Copilot
**Git Commit**: `f669113482839dac1b4e83620acdbbe3dc591101`
**Branch**: `master`
**Repository**: `MatIwa/10xCards`

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` for its remaining risks (Risk #3 already shipped via `context/changes/testing-rls-cross-user-access/`):

- **Risk #4** — source-text non-retention: on both success and error paths of `/api/flashcards/generate`, the pasted source text does not appear in any DB row, any log line, the error response body, or persistent observability. Must challenge "we never call `.insert()` with the source text — exception handlers that echo the request body are the usual leak."
- **Risk #7** — server-side input validation: a `POST /api/flashcards/generate` with too-short, too-long, wrong-type, or missing-field body is rejected with a 400 before the LLM is called. Must challenge "the client validates" and "the LLM will handle it."

For each risk, verify the response guidance from §2 Risk Response Guidance against real code, identify the cheapest useful test layer, flag speculative risks, and locate any existing coverage. This slice's oracle must come from the test plan / PRD / product behavior, **not** from the current implementation's output.

## Summary

Both risks are real and testable at a single layer (**direct API-route integration** using the harness already established by the RLS slice), but neither is currently covered:

- **Risk #4 is real but the code is clean today.** Source text flows only through `route → service → OpenRouter`. It is never persisted (no `.insert()` on this path — [flashcard.service.ts](../../../src/lib/services/flashcard.service.ts) is called only from other endpoints), never logged (the sole `console.error` on the path emits an error-constructor name, not content), and never echoed by a canned error message. The one remaining vector is the **Zod validation 400 response**, which returns `parsed.error.issues` verbatim to the client — a runtime probe against the actual schema confirms Zod v4.4.3 does not include the raw input for `invalid_type` / `too_small` / `too_big` issues, so the current code is safe. The test's job is to **lock this contract** so a future edit (a `.refine()` echoing input, a body-dumping error handler, a debug log) breaks a test.
- **Risk #7 is real and un-tested.** The server-side Zod gate exists at [generate.ts:46-49](../../../src/pages/api/flashcards/generate.ts#L46-L49) and does execute before the LLM call at [generate.ts:51](../../../src/pages/api/flashcards/generate.ts#L51), but no test asserts the ordering or the rejection. A refactor that reshuffles the order — or a later "just let the LLM handle it" change — would blow up cost silently. Test asserts both `400` on bad payloads and that the outbound `fetch` to OpenRouter is never called.
- **Cheapest useful test layer** is the direct API-route integration test using [`invokeApiRoute()`](../../../test/helpers/invoke-api-route.ts) with the fetch stub replaced by `vi.stubGlobal("fetch", vi.fn())` (unit-style, no LLM cost). No real Supabase user or DB seeding is required for the validation-failure and privacy assertions on the response body. A DB post-check (via [`readFlashcards`](../../../test/helpers/db.ts)) locks the "no persistence on any branch" contract with negligible cost.
- **Existing coverage does not touch this contract.** The unit test [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts) tests the service in isolation. The component-level integration test [GenerateFlashcards.integration.test.tsx](../../../src/components/dashboard/GenerateFlashcards.integration.test.tsx) drives the real route but only asserts the happy path — no privacy check on error bodies, no direct 400-payload cases.

Ordering: cover Risk #7 first (cheapest, fastest — pure request/response assertions). Layer Risk #4 assertions on the same test file since the harness and probe token are shared.

## Detailed Findings

### `POST /api/flashcards/generate` — full data-flow audit for `source_text`

Reference: [src/pages/api/flashcards/generate.ts](../../../src/pages/api/flashcards/generate.ts)

Sequential path through the handler:

1. **Supabase client construction** — [generate.ts:29](../../../src/pages/api/flashcards/generate.ts#L29). Returns 500 `{ error: "Supabase is not configured" }` if unavailable. No body access, no leak vector.
2. **Auth gate** — [generate.ts:34](../../../src/pages/api/flashcards/generate.ts#L34). Reads `context.locals.user` (populated by middleware). Returns 401 `{ error: "Unauthorized" }` on failure. No body access.
3. **Body parse** — [generate.ts:38-43](../../../src/pages/api/flashcards/generate.ts#L38-L43). `await context.request.json()` in try/catch; on failure returns 400 `{ error: "Invalid JSON body" }` via `badRequest()`. No raw body echoed.
4. **Zod validation** — [generate.ts:46-49](../../../src/pages/api/flashcards/generate.ts#L46-L49). `generateFlashcardsSchema.safeParse(payload)`; on failure returns 400 `{ error: "Validation failed", issues: parsed.error.issues }` via `badRequest()`. **This is the only path where a Zod-authored payload structure is echoed to the client.** See "Zod v4 issue shape at runtime" below.
5. **Service call** — [generate.ts:51-54](../../../src/pages/api/flashcards/generate.ts#L51-L54). `generateProposals(parsed.data.source_text)`. Errors are mapped through `mapGenerationError()` at [generate.ts:11-17](../../../src/pages/api/flashcards/generate.ts#L11-L17) which returns hardcoded shapes: `{ error, code }` — the `error` value comes from `GenerationError.message`, all of which are static strings defined in the service.
6. **Success response** — [generate.ts:56](../../../src/pages/api/flashcards/generate.ts#L56). `{ proposals: result.data }` where each proposal is `{ id, front, back }` produced by the LLM. `source_text` is never copied into a proposal.
7. **Unexpected-error catch** — [generate.ts:57-61](../../../src/pages/api/flashcards/generate.ts#L57-L61). Logs `console.error("generate_route_unexpected", { error: unexpectedErrorName(error) })` where `unexpectedErrorName` at [generate.ts:19-25](../../../src/pages/api/flashcards/generate.ts#L19-L25) returns only the constructor name or `typeof error`. Response is a hardcoded `{ error: "Internal error", code: "internal_error" }`. **No request body or `source_text` reaches the log arguments or the response.**

### `ai-generation.service.ts` — leak vectors in every error branch

Reference: [src/lib/services/ai-generation.service.ts](../../../src/lib/services/ai-generation.service.ts)

| Branch | Line | Return value | Content leak? |
|---|---|---|---|
| Missing API key | [L91](../../../src/lib/services/ai-generation.service.ts#L91) | `error: { code: "missing_api_key", message: "AI generation is not configured" }` | No — hardcoded |
| Network / abort | [L97-L100](../../../src/lib/services/ai-generation.service.ts#L97-L100) | `error: { code: "provider_unavailable", message: "The AI service timed out" \| "temporarily unavailable" }` | No — hardcoded |
| Non-ok HTTP | [L104](../../../src/lib/services/ai-generation.service.ts#L104) | `error: { code: "provider_unavailable", message: "temporarily unavailable" }` | No — hardcoded; **response body from OpenRouter is discarded** |
| JSON parse of provider response | [L110](../../../src/lib/services/ai-generation.service.ts#L110) | `error: { code: "invalid_model_output", message: "The AI response could not be parsed" }` | No — hardcoded |
| Model-output schema mismatch | [L116-L120](../../../src/lib/services/ai-generation.service.ts#L116-L120) | `error: { code: "invalid_model_output", message: "The AI response was not in the expected format" }` | No — hardcoded |
| Empty cards | [L123](../../../src/lib/services/ai-generation.service.ts#L123) | `error: { code: "empty_result", message: "The AI did not find testable content in this text" }` | No — hardcoded |
| Success | [L126-L131](../../../src/lib/services/ai-generation.service.ts#L126-L131) | `data: [{ id: crypto.randomUUID(), front, back }, ...]` | No — `sourceText` not reused; front/back come from LLM |

The `sourceText` parameter is used exactly once outside the outbound fetch: to name a variable in [L70](../../../src/lib/services/ai-generation.service.ts#L70). It appears in the OpenRouter request body at [L67](../../../src/lib/services/ai-generation.service.ts#L67) (`{ role: "user", content: sourceText }`), never in a log, never in an error object, never in a persisted row.

### DB persistence audit

Grep of `source_text` / `sourceText` across `src/` returned 20+ hits — all fall into three buckets:

- **React component state** in [GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx) (never sent back to the server after the initial POST; wiped by `setSourceText("")` at [L217](../../../src/components/dashboard/GenerateFlashcards.tsx#L217) on successful save).
- **API route / service** — see above.
- **The `service` test** — mocks fetch; no DB writes.

The `flashcards` table row shape has fields `front`, `back`, `source`, `user_id`, `created_at`, `updated_at` — no `source_text` column. Insert callers ([flashcard.service.ts](../../../src/lib/services/flashcard.service.ts)) accept only `{ front, back, source }` — the `source` field is a category enum (`"manual"` or `"ai"`), not the raw text. **`source_text` cannot reach the DB from the generate endpoint** because the endpoint never calls the flashcard service.

### Cloudflare Workers observability

- [wrangler.jsonc](../../../wrangler.jsonc): `observability: { enabled: true }`.
- Cloudflare Workers Observability captures request metadata (method, path, status, duration, error name from `console.error`) and structured log lines emitted via `console.*`. **It does not capture request/response bodies unless explicitly configured** (via `logpush`, `tail_consumers`, or a custom handler that emits them).
- The generate path emits exactly one `console.error` at [generate.ts:59](../../../src/pages/api/flashcards/generate.ts#L59) with arguments `("generate_route_unexpected", { error: unexpectedErrorName(error) })`. This is safe.
- No Sentry / OTel / DataDog SDK is initialized anywhere in `src/`.

### Zod v4 issue shape at runtime — the critical leak vector

Zod v4.4.3 defines `$ZodIssueBase` with an **optional** `input` field ([node_modules/zod/v4/core/errors.d.ts:5-11](../../../node_modules/zod/v4/core/errors.d.ts#L5-L11)):

```ts
export interface $ZodIssueBase {
    readonly code?: string;
    readonly input?: unknown;   // <-- optional; runtime behavior determines whether it's populated
    readonly path: PropertyKey[];
    readonly message: string;
}
```

Sub-issues (`too_small`, `too_big`, `invalid_type`, `unrecognized_keys`) all redeclare `readonly input?: Input`. The type does **not** guarantee the runtime absence of `input`. To resolve this, a runtime probe was executed against the actual `generateFlashcardsSchema` from [ai-generation.schemas.ts](../../../src/lib/schemas/ai-generation.schemas.ts) using the same Zod version the app runs. Results (`JSON.stringify(issue)` — what actually leaves the server):

| Input case | Emitted issue (JSON) |
|---|---|
| `{}` (missing) | `{"expected":"string","code":"invalid_type","path":["source_text"],"message":"Invalid input: expected string, received undefined"}` |
| `{ source_text: "" }` (empty) | `{"origin":"string","code":"too_small","minimum":200,"inclusive":true,"path":["source_text"],"message":"Too small: expected string to have >=200 characters"}` |
| `{ source_text: 123 }` (wrong type) | `{"expected":"string","code":"invalid_type","path":["source_text"],"message":"Invalid input: expected string, received number"}` |
| `{ source_text: "SECRET_..."/50 chars/ }` (too short) | `{"origin":"string","code":"too_small","minimum":200,"inclusive":true,"path":["source_text"],"message":"Too small: expected string to have >=200 characters"}` |
| `{ source_text: "L".repeat(25001) }` (too long) | `{"origin":"string","code":"too_big","maximum":25000,"inclusive":true,"path":["source_text"],"message":"Too big: expected string to have <=25000 characters"}` |
| `{ source_text: valid, naughty: "SECRET" }` (extra key) | `OK` — schema strips (default `.strip()`); returns 200. |
| `"SECRET_BODY_IS_A_STRING"` (non-object) | `{"expected":"object","code":"invalid_type","path":[],"message":"Invalid input: expected object, received string"}` |

**Verdict:** For every failure path in `generateFlashcardsSchema`, the emitted JSON does not contain the raw input value. The `received` sub-field carries only the type name (`"undefined"`, `"number"`, `"string"`), never the value.

**But** — this is verified behavior of the current Zod version and current schema shape. Two future changes would flip it:

1. A `.refine((val) => ...)` or `.superRefine((val, ctx) => ctx.addIssue({ code: "custom", message: ..., input: val }))` on `source_text`. `code: "custom"` issues carry the input by convention.
2. A Zod upgrade or config change that turns on `.strict()` on the outer object: `unrecognized_keys` issues carry `keys: string[]` and would leak key names of any submitted payload (e.g., a client bug that includes PII in a stray field).

The test asserts on the **response body shape** as it leaves the server: no substring of the raw source text should be findable in `await response.text()` for any of these failure paths. This locks the contract independently of Zod's internal issue shape.

### Server-side input validation — Risk #7

- Schema definition: [ai-generation.schemas.ts:15-20](../../../src/lib/schemas/ai-generation.schemas.ts#L15-L20). Requires `source_text` string, trimmed, min 200 chars, max 25000 chars. Defaults to `.strip()` unknown keys.
- Client-side mirror: [GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx) uses `MIN_CHARS` and `MAX_CHARS` constants (currently aligned with server), disables the submit button until `canGenerate` at [L132](../../../src/components/dashboard/GenerateFlashcards.tsx#L132), and normalizes with `.trim()` before POST.
- **Ordering:** at [generate.ts:46-51](../../../src/pages/api/flashcards/generate.ts#L46-L51), the `safeParse` and early-return on failure runs strictly before `generateProposals` (which is the sole caller of `fetchOpenRouter`). No LLM cost can be incurred on a validation failure at the current commit.
- **Bypass surface:** any HTTP client can POST directly (curl, Postman, malicious script). This is exactly the surface Risk #7 targets — the client-side gate does not protect it.
- Note: the schema is not `.strict()`, so `{ source_text: "..." + valid, other: "..." }` currently returns 200 (with stray keys silently dropped). Whether "extra keys must be rejected" is part of Risk #7's contract is a judgment call — the PRD does not require it. Leaving `.strip()` alone is fine; the test can lock that current behavior (accept-and-strip) as a way to notice future churn.

### Existing test coverage (gap analysis)

- **Unit** — [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts) tests `generateProposals` in isolation with `vi.stubGlobal("fetch", vi.fn())`. Covers valid/malformed/empty LLM response, timeout, missing API key. **Does not touch the route, does not touch the request-body contract, does not assert on the shape of `parsed.error.issues`, does not assert on log arguments.** It is the reference pattern for `fetch` stubbing (see the `envMock` at [L3-L11](../../../src/lib/services/ai-generation.service.test.ts#L3-L11) — the pattern for env-var mutation the plan can reuse).
- **Component-level integration** — [GenerateFlashcards.integration.test.tsx](../../../src/components/dashboard/GenerateFlashcards.integration.test.tsx) drives the real component, routes `POST /api/flashcards` (the SAVE endpoint) to the real handler via [api-route-fetch-stub.ts](../../../test/helpers/api-route-fetch-stub.ts). **It does not exercise `POST /api/flashcards/generate` at the route level** — the fetch stub returns a canned proposal response for that URL (see [api-route-fetch-stub.ts:61](../../../test/helpers/api-route-fetch-stub.ts#L61) per the audit).
- **Route-level integration** — [flashcards-cross-user.integration.test.ts](../../../test/rls/flashcards-cross-user.integration.test.ts) uses [`invokeApiRoute()`](../../../test/helpers/invoke-api-route.ts) + [`createIntegrationUser()`](../../../test/helpers/integration-user.ts) to POST/GET/PUT/DELETE against the real handlers. This is the pattern to reuse. **`/api/flashcards/generate` is not touched by any test file today.**

### Cheapest useful test layer

The behavior under test is 100% route-boundary behavior (parse → validate → call LLM → shape response). It does not depend on DB state or real user sessions. **Direct API-route integration using `invokeApiRoute()` with a globally stubbed `fetch` is the cheapest useful layer.**

- Vitest project: `integration` (env vars for Supabase are already wired there; the route calls `createClient` which needs them).
- Session injection: `invokeApiRoute({ session: { userId: <fake-uuid>, cookieHeader: "" }, handler: POST })` — the helper synthesizes `context.locals.user = { id: userId }` at [invoke-api-route.ts:64-66](../../../test/helpers/invoke-api-route.ts#L64-L66) without querying Supabase, so no seeded user is strictly required for the validation-failure branches or the auth-required branches.
- The DB post-check for Risk #4 ("no flashcard row for this user contains the probe token in `front` or `back`") is cheap but requires a real user id. Use [`createIntegrationUser`](../../../test/helpers/integration-user.ts) once at `beforeEach`; reset with [`resetFlashcards`](../../../test/helpers/db.ts) at `afterEach`. This is the same setup the RLS test already uses.
- Global fetch stub: `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach` — mirrors the pattern in [ai-generation.service.test.ts](../../../src/lib/services/ai-generation.service.test.ts#L37-L43).

Do not use MSW: the fetch stub is already the established pattern and MSW would drag in setup cost for a one-endpoint boundary.
Do not use Playwright / e2e: the leak vectors (response body shape, log-line arguments) are not observable through a browser at the fidelity a route-level test provides.

### Response-guidance verification

| Risk | §2 guidance says | Verified? |
|---|---|---|
| #4 | Prove: source text absent from DB, logs, error body, observability. | Yes — every listed sink audited. Real code is safe; test locks it. |
| #4 | Must challenge: "we never call `.insert()` with the source text — exception handlers that echo the request body are the usual leak." | Confirmed. `.insert()` never called on this path. The one non-trivial vector is `parsed.error.issues` in the 400 response — runtime-probed clean today; test must assert. |
| #4 | Cheapest layer: integration (happy + forced-error paths, assert on response body and DB state). | Confirmed. Route-level `invokeApiRoute()` + `readFlashcards()` post-check. |
| #4 | Anti-pattern: only testing happy path; not covering unexpected exceptions; not asserting on the error-body shape. | Test must include all failure branches enumerated above (validation, provider unavailable, empty result, unexpected). |
| #7 | Prove: 400 rejection before LLM call for too-short / too-long / wrong-type / missing-field. | Confirmed. Order at [generate.ts:46-51](../../../src/pages/api/flashcards/generate.ts#L46-L51) is validate-then-call. Test asserts by spying on the stubbed `fetch` (`expect(fetch).not.toHaveBeenCalled()`). |
| #7 | Must challenge: "the client validates" and "the LLM will handle it". | Confirmed. Client-side gate exists but does not protect the endpoint from direct HTTP callers; server gate must be tested independently. |
| #7 | Cheapest layer: unit (server-side Zod schema) + one integration (bad payloads → 400, no upstream call). | The integration side is sufficient on its own for this endpoint — one file covers validation shape and no-upstream-call. Separate unit tests on the schema in isolation would repeat what the route test proves. |
| #7 | Anti-pattern: relying on OpenRouter to time out; testing only the happy-path payload; asserting on the client-side schema. | Test posts direct HTTP payloads (not through the React component) and asserts on the route response. |

### Speculative-risk check

- **Risk #4**: real. Response body is a live leak surface; the current code is clean by construction (canned messages, no body echo, no persistence) — the test locks each of these against future churn. Not speculative.
- **Risk #7**: real. Validation exists; no test locks the order or the rejection. A future change that inlines the LLM call before parsing (e.g., "quick prompt-tuning experiment") would silently succeed. Not speculative.
- **Hot-spot evidence** in §2 for Risk #7 cited `src/pages/api/ — 3 commits/30d`. That directory contains the endpoint. Evidence remains valid; no correction needed.
- **Hot-spot evidence** for Risk #4 cited: PRD NFR + AGENTS.md rule (rule-based, no hot-spot). Evidence remains valid.

**No test-plan backport is required.** Response guidance for both risks matches the code as researched; the citations in §2 hold up.

## Code References

- `src/pages/api/flashcards/generate.ts:29-61` — full handler; validation-then-service ordering at [L46-L51](../../../src/pages/api/flashcards/generate.ts#L46-L51); catch-all logging at [L59](../../../src/pages/api/flashcards/generate.ts#L59)
- `src/pages/api/flashcards/generate.ts:11-17` — `mapGenerationError` produces hardcoded 500/502 shapes
- `src/pages/api/flashcards/generate.ts:19-25` — `unexpectedErrorName` (constructor name only)
- `src/lib/services/ai-generation.service.ts:56-77` — `fetchOpenRouter`, sole outbound use of `sourceText`
- `src/lib/services/ai-generation.service.ts:82-132` — `generateProposals`, every error branch returns a hardcoded message
- `src/lib/schemas/ai-generation.schemas.ts:15-20` — server-side Zod schema for the request body
- `src/components/dashboard/GenerateFlashcards.tsx:119-169` — client-side state + submit; the surface a direct HTTP client bypasses
- `src/middleware.ts:1-31` — no body access, no logging
- `wrangler.jsonc` — `observability.enabled: true` (metadata-only capture by default)
- `src/lib/services/ai-generation.service.test.ts:3-11` — env-var `vi.hoisted` + getter pattern to reuse; [L37-L43](../../../src/lib/services/ai-generation.service.test.ts#L37-L43) — `vi.stubGlobal("fetch", vi.fn())` pattern to reuse
- `test/helpers/invoke-api-route.ts:64-66` — synthesizes `locals.user` without a real Supabase session
- `test/helpers/integration-user.ts` — reference for `createIntegrationUser()` (needed only for the DB post-check)
- `test/helpers/db.ts:33-46` — `readFlashcards(userId)` and `resetFlashcards(userId)` for the DB post-check
- `test/rls/flashcards-cross-user.integration.test.ts:66-100` — reference test structure: `beforeEach`/`afterEach` with reset, session injection, direct-handler invocation
- `node_modules/zod/v4/core/errors.d.ts:5-11` — `$ZodIssueBase` type; `input` is optional on the base

## Architecture Insights

- **Route-level tests are cheap here** because the endpoint's contract is a pure request→response shape. No DB writes on this endpoint mean no seeding is required for the primary assertions; a single seeded user + `resetFlashcards` for the DB post-check covers Risk #4's DB axis at almost no extra cost.
- **The `vi.stubGlobal("fetch", vi.fn())` pattern is the project's canonical way to control the LLM boundary.** It sits at the module boundary (the service uses global `fetch`), stubs both the outbound OpenRouter call and any potential leakage into other outbound calls, and lets `expect(fetch).not.toHaveBeenCalled()` prove Risk #7's "before the LLM" ordering.
- **The probe-token oracle** (embed a UUID/nonce inside the source text; assert it appears nowhere in the response body, no DB row, and no captured `console.error` args) satisfies the "oracle from the risk, not from the code" rule. The current implementation's specific error strings must not be re-asserted verbatim, or the test becomes a mirror. Instead, assert on **negative properties** (probe token is absent) and **status codes** (400 / 401 / 500 / 502 / 200 as appropriate).
- **`vi.spyOn(console, "error")** is already implicitly needed for the unexpected-error branch (Risk #4 requires "no log line contains source text"). Combine `vi.spyOn(console, "error").mockImplementation(() => {})` with a probe-token assertion on every call's argument.
- **The schema's default `.strip()`** turns unrecognized keys into a silent success. This is safe for Risk #4 (no leak — keys and values simply don't appear in `issues`) but is a fact worth locking with one test case, since a future `.strict()` flip would introduce a new `unrecognized_keys` issue shape that echoes key names.

## Historical Context (from prior changes)

- [context/changes/testing-ai-generation-critical-path/plan.md](../testing-ai-generation-critical-path/plan.md) — Phase 1 plan that established the Vitest workspace (`unit` + `integration` projects), the `vi.stubGlobal("fetch", ...)` pattern, and the astro-env-server alias. All this infra is reusable.
- [context/changes/testing-rls-cross-user-access/plan.md](../testing-rls-cross-user-access/plan.md) — Phase 2 slice #1: established `invokeApiRoute()`, `createIntegrationUser()`, `createCookieSink()`, and the two-user harness. This slice reuses `invokeApiRoute()` and `createIntegrationUser()`; two users are not needed (single-user assertion), but the helper is happy to be called with one.
- [context/changes/testing-rls-cross-user-access/research.md](../testing-rls-cross-user-access/research.md) — reference oracle-table structure for §6 of this research file (not replicated here because the risks are more surface-shaped than the RLS case-matrix).
- [context/archive/2026-06-23-ai-flashcard-generation/plan.md](../../archive/2026-06-23-ai-flashcard-generation/plan.md) — original AI-generation slice; model swap note explains why the current model id is `liquid/lfm-2.5-1.2b-instruct:free`.
- [context/foundation/lessons.md](../../foundation/lessons.md) — no directly-relevant lesson for this slice (the account-deletion cascade lesson is for Risk #5, not this phase).

## Related Research

- [context/changes/testing-rls-cross-user-access/research.md](../testing-rls-cross-user-access/research.md) — same phase (server-boundary contracts), sibling slice for Risk #3.
- [context/changes/testing-ai-generation-critical-path/](../testing-ai-generation-critical-path/) — established the fetch-stub and env-mock patterns this slice reuses.

## Open Questions

- **Is the "no unknown keys" property in scope for Risk #7?** The schema currently `.strip()`s them. Two options for the plan:
  - **Lock current behavior** (extra keys → 200, keys silently dropped): one test case documents this so a future `.strict()` flip is a visible change.
  - **Test only the four bounded cases** listed in the risk guidance (too-short / too-long / wrong-type / missing) and leave `.strip()` behavior untested.
  - Recommendation: option A, one line of test, negligible cost. `/10x-plan` to confirm.
- **Should the unexpected-error branch (top-level `catch`) get a dedicated test?** Triggering it requires forcing an error before the safeParse (e.g., stubbing `context.request.json()` to throw a non-SyntaxError — but that's caught explicitly at [L41-L43](../../../src/pages/api/flashcards/generate.ts#L41-L43)) or forcing `createClient` to throw. Cheapest trigger: stub `fetch` to throw a non-Abort error inside the service call, which will bubble up to the outer `catch` only if `generateProposals` doesn't catch it — but it does (see [service.ts:95-100](../../../src/lib/services/ai-generation.service.ts#L95-L100)). To reach the top-level catch, need to force something inside the try that isn't caught elsewhere — e.g., stubbing `Response.json` to throw. This is fragile; a lighter approach is a `describe.skip`-guarded manual test, or asserting the log arguments only via a `console.error` spy across all provoked errors (none of which currently reach the top-level catch). Recommendation: skip the top-level catch as a dedicated case; the probe-token-in-console-error spy across the other branches proves the observable property.
- **Is DB post-check for Risk #4 needed on every case, or just once?** Every "resolved-response" case (200, 502, 500 empty-result, 400 validation) should have the post-check that `readFlashcards(userId)` returns `[]`. This is cheap and locks the "generate never persists" property even if a future refactor tries to add a "history" log to the DB.
