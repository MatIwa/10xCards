# AI Flashcard Generation Implementation Plan

## Overview

Implement roadmap slice S-03 (AI differentiator). A logged-in user pastes source text (200–25,000 chars), triggers AI generation, and reviews a list of card proposals returned by OpenRouter's free-tier `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` model. Each proposal can be accepted as-is (`source: 'ai_full'`), edited inline then accepted (`source: 'ai_edited'`), or rejected. Accepted cards are persisted one at a time through the existing `POST /api/flashcards` endpoint; rejected proposals never reach the database. Source text is never logged or persisted.

## Current State Analysis

- `flashcards` table already supports the three-way provenance via `flashcards_source_valid` check constraint (`'manual' | 'ai_full' | 'ai_edited'`) — landed in `supabase/migrations/20260531120000_create_flashcards.sql`.
- `FlashcardSource` exported from `src/types.ts:1`.
- Manual CRUD (S-01) is live and established the patterns: Zod schemas in `src/lib/schemas/`, services in `src/lib/services/`, uppercase HTTP exports in `src/pages/api/...`, middleware-driven auth in `src/middleware.ts`, React islands in `src/components/dashboard/`, server-only env via `astro:env/server`.
- `src/pages/api/flashcards/index.ts:30` (`POST`) hardcodes `source: 'manual'` — currently no API path can persist an AI-sourced card.
- `src/lib/services/flashcard.service.ts:26` (`createFlashcard`) hardcodes `source: 'manual'` at the DB-insert layer — both layers must be extended to propagate an explicit source.
- `src/lib/schemas/flashcard.schemas.ts:8` (`createFlashcardSchema`) currently accepts only `{ front, back }` — needs an optional `source` field bounded to `'manual' | 'ai_full' | 'ai_edited'` defaulting to `'manual'`.
- No LLM dependency, no OpenRouter env var, no AI route, no generate UI exist today. `astro.config.mjs:17` only declares `SUPABASE_URL` and `SUPABASE_KEY` in the env schema.
- The repo has no test runner — verification is `npm run lint` + `npm run build` + manual walkthrough, mirroring `sr-review-session`.
- Middleware already protects all `/api/flashcards/*` paths (`src/middleware.ts:5`), so adding `/api/flashcards/generate` requires no middleware change.
- `wrangler.jsonc` has `nodejs_compat` enabled and `observability.enabled: true` — important: Workers logs go to Cloudflare; we must not log the source text.

### Key Discoveries:

- The PRD privacy NFR is operationalised as: **do not write the user-submitted source text to any log line, error payload, telemetry, or database row.** Cloudflare Workers `console.log` ships to the Cloudflare Logs UI (observability enabled in `wrangler.jsonc`), so the rule extends to `console.error` on parse failures too.
- The selected OpenRouter free-tier model (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`) accepts `response_format: { type: "json_object" }` in a live smoke test and returned `usage.cost: 0` — we'll use it for MVP testing without credits.
- Cloudflare Workers has a 128 MB isolate memory ceiling and CPU-time budgets (per `context/foundation/infrastructure.md`). Generation is the heaviest request: cap input at 25,000 chars and stream the OpenRouter response via `fetch` (no full-body buffering needed beyond what `Response.json()` requires for a ≤15-card payload — small).
- `Flashcard` rows have ~14 columns the API returns; the proposal shape is much smaller (`{ id, front, back }` where `id` is a client-side proposal id, NOT a `flashcards.id`).
- Dashboard already wires `/dashboard/review` (`src/pages/dashboard/review.astro:1`); the `/dashboard/generate` page mirrors that scaffold.

## Desired End State

A logged-in user can:
1. Click "Generate cards" from `/dashboard` and land on `/dashboard/generate`.
2. Paste 200–25,000 chars into a textarea (live char count, inline validation, paste-area is the only place source text exists in the system).
3. Click "Generate" and see a visible, animated progress indicator while the request runs.
4. Receive between 1 and 15 proposal cards, each rendered as an editable front/back pair with Accept, Edit, and Reject affordances.
5. Accept any proposal — the card is saved instantly via `POST /api/flashcards` with `source: 'ai_full'` (untouched) or `source: 'ai_edited'` (text changed since the model returned it), and disappears from the proposal list.
6. Reject any proposal — it disappears from the list without any network call.
7. When the proposal list is empty, the page returns to the paste form with a fresh textarea.
8. On failure (provider error, malformed JSON, zero cards), see a clear error banner with a "Retry" button; **the pasted source text is preserved in the textarea so retry is one click.**

Verification:
- `npm run lint` and `npm run build` pass.
- Manual walkthrough: paste-generate-accept-reject-edit cycle works end-to-end against a real OpenRouter key.
- Privacy check: grep the codebase for any logging of `source_text`, `sourceText`, or the raw request body and confirm none exists; verify `wrangler tail` during a generation never shows the pasted content.
- RLS isolation holds (already proven by S-01) — AI-accepted cards inherit the same auth path as manual cards.

## What We're NOT Doing

- No streaming response (SSE/chunked). We ship a single JSON response with the full proposal batch and lean on a visible progress indicator for the NFR.
- No per-user rate limiting / abuse cap / KV-backed counter. OpenRouter's own limits plus the 25k-char input ceiling are the MVP guards.
- No partial-success or auto-retry. Generation is all-or-nothing; the user retries explicitly.
- No persistence of rejected proposals, the source text, the prompt, or the raw model response — anywhere.
- No `generation_jobs` table, no batch save, no undo-after-accept, no "generate more" pagination, no deduplication against existing cards.
- No multi-format input (PDF, URL, file upload). Paste only — already a PRD non-goal.
- No model-selection UI; model is hardcoded.
- No prompt-tuning UX (temperature, style, language hints).
- No automated tests — repo has no test runner today (consistent with S-01 and S-02).

## Implementation Approach

Three phases in strict dependency order: (1) Foundation — env wiring, schemas, the OpenRouter service module, and the small extension to `createFlashcard` so the existing endpoint can accept an AI-sourced card; (2) the new generation API route that orchestrates auth, validation, service call, and error mapping; (3) the dedicated `/dashboard/generate` page with its React island that handles paste, progress, proposal review, accept/edit/reject, and error recovery. Phase 1 is independently verifiable via build + a scratch fetch; Phase 2 via manual `curl`; Phase 3 via end-to-end manual walkthrough.

## Critical Implementation Details

- **Privacy enforcement** — The source text crosses exactly two surfaces: (a) the inbound `Request.json()` body in the generate route, (b) the `messages` array passed to `fetch(OPENROUTER_URL)`. It must never appear in `console.log`, `console.error`, a thrown `Error.message`, a returned JSON error payload, or a DB write. All error logging in the service module logs only the **failure class** (HTTP status, error code), never the request body. Any thrown error caught at the route handler is mapped to a typed `{ error, code }` response — the original error message is not echoed back to the client and not logged with the source text alongside. **The rule extends to thrown errors:** no `throw new Error(...)` in the service or route may interpolate `sourceText`, the raw model response, or the OpenRouter request body — all such failure paths return a typed `GenerationError` instead. The Phase 2 route handler wraps its body in a top-level `try/catch` that maps any unexpected throw to `500 { error: "Internal error", code: "internal_error" }` and logs only the error constructor name (e.g. `console.error('generate_route_unexpected', { error: err?.constructor?.name })`).
- **Source-discrimination contract** — The proposal-review React island holds, for each proposal, both the **original** `{ front, back }` returned by the model and the **current edited** `{ front, back }`. On Accept it compares trimmed values: equal → `source: 'ai_full'`, different → `source: 'ai_edited'`. The server does NOT compare; it trusts the client's `source` field (validated by Zod against the enum). This is acceptable because `source` is not a security-sensitive field — it's an analytics signal for the 75% acceptance metric. Worst case a user manually mislabels their own card.
- **OpenRouter JSON mode** — Request uses `response_format: { type: "json_object" }` and a system prompt that defines the exact output schema (`{ cards: [{ front, back }] }`). The service validates the parsed shape with Zod before returning — any drift maps to error code `invalid_model_output`.

## Phase 1: AI Service Foundation

### Overview

Wire the OpenRouter env var into the Astro env schema, add the generation Zod schemas, build `ai-generation.service.ts` (prompt + OpenRouter call + parse + error mapping), and extend `createFlashcardSchema` + `createFlashcard` to carry an explicit `source` value so AI-accepted cards can be persisted through the existing endpoint.

### Changes Required:

#### 1. Add `OPENROUTER_API_KEY` to env schema

**File**: `astro.config.mjs`

**Intent**: Make `OPENROUTER_API_KEY` available via `astro:env/server` so the service module can import it the same way `supabase.ts` imports `SUPABASE_KEY`. Optional so dev environments without a key still build (mirrors the Supabase pattern at `src/lib/supabase.ts:6`).

**Contract**: `OPENROUTER_API_KEY` added to the `env.schema` block as `envField.string({ context: "server", access: "secret", optional: true })`. No client exposure.

#### 2. Document the new secret

**File**: `.env.example`

**Intent**: Tell developers (and future agents reading the repo) which env var is required for AI generation and how to populate `.dev.vars` for `wrangler dev`.

**Contract**: A new `OPENROUTER_API_KEY=` line with a short inline comment pointing at `https://openrouter.ai/keys`.

#### 3. Generation request + proposal schemas

**File**: `src/lib/schemas/ai-generation.schemas.ts`

**Intent**: Define the Zod schemas for the generate request body, the model output, and the public proposal shape returned to the client. Export inferred TypeScript types.

**Contract**:
- `generateFlashcardsSchema` — validates `{ source_text: string (trimmed, 200–25,000 chars) }`.
- `modelOutputSchema` — validates the parsed JSON returned by OpenRouter: `{ cards: Array<{ front: string (1–1000), back: string (1–5000) }> }` with a non-empty array and a hard ceiling of 15 cards (model output beyond 15 is truncated, not rejected, to preserve UX on the off-chance the model overshoots).
- `proposalSchema` — public response shape: `{ id: string, front: string, back: string }` where `id` is a server-generated UUID v4 used only as a React key on the client.
- Exported types: `GenerateFlashcardsInput`, `ModelOutput`, `Proposal`.

#### 4. Extend the flashcard create schema with an explicit `source`

**File**: `src/lib/schemas/flashcard.schemas.ts`

**Intent**: Allow callers to specify the card's provenance. Default keeps existing manual-create callers (the dashboard form) unchanged.

**Contract**: `createFlashcardSchema` gains an optional `source: z.enum(['manual', 'ai_full', 'ai_edited'])` field defaulting to `'manual'`. The exported `CreateFlashcardInput` type now includes `source`.

#### 5. Propagate `source` through the service layer

**File**: `src/lib/services/flashcard.service.ts`

**Intent**: Stop hardcoding `source: 'manual'`. The service trusts the validated `source` from the Zod schema (which already restricts it to the enum).

**Contract**: `createFlashcard(supabase, input, userId)` inserts with `source: input.source` instead of the literal `'manual'`. Behaviour for existing callers is unchanged because the schema default fills in `'manual'`.

#### 6. AI generation service

**File**: `src/lib/services/ai-generation.service.ts`

**Intent**: Encapsulate the entire OpenRouter call: build the system + user prompt, POST to OpenRouter chat completions with JSON-mode, parse and validate the response, and return either a `Proposal[]` or a typed error. The service never logs the input text.

**Contract**:
- Default model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. The model id is a module-level constant; we will keep it hardcoded for MVP (no env override) and use OpenRouter's free tier for local/manual testing.
- Exported `generateProposals(sourceText: string): Promise<GenerateResult>` where `GenerateResult = { data: Proposal[]; error: null } | { data: null; error: GenerationError }`.
- `GenerationError = { code: 'missing_api_key' | 'provider_unavailable' | 'invalid_model_output' | 'empty_result'; message: string }`.
- Reads `OPENROUTER_API_KEY` from `astro:env/server`; returns `missing_api_key` if absent (do not throw — the route maps it to a 500 with a generic message).
- POSTs to `https://openrouter.ai/api/v1/chat/completions` with `response_format: { type: "json_object" }`, `temperature: 0.1`, and a system prompt that instructs the model to extract testable knowledge units as `{ cards: [{ front, back }] }` with up to 15 entries, no preamble, no markdown.
- **Draft system prompt** (implementer may tune wording, but constraints are binding):

  ```
  You generate flashcards from study material. Read the user's text and extract up to 15 testable knowledge units as question/answer pairs.

  Output rules (strict):
  - Respond with JSON only. No prose, no markdown, no code fences, no preamble, no trailing commentary.
  - Schema: {"cards": [{"front": string, "back": string}, ...]}
  - front: a concise question or prompt, at most 1000 characters.
  - back: a complete, self-contained answer, at most 5000 characters.
  - 1 to 15 cards. Quality over quantity — skip filler facts.
  - Write cards in the same language as the source text.
  - Do not invent facts not present in the source. If the source has no testable content, return {"cards": []}.
  ```

  The user message is the raw `sourceText`. No additional system text is appended.
- Parses `choices[0].message.content` as JSON; validates with `modelOutputSchema`; truncates to 15; assigns a fresh `crypto.randomUUID()` to each proposal's `id`.
- Maps OpenRouter HTTP failures (non-2xx, network errors) to `provider_unavailable`; JSON parse/schema failures to `invalid_model_output`; a valid-but-empty `cards` array to `empty_result`.
- **60-second timeout via `AbortController`** wrapping the OpenRouter `fetch`; on `AbortError` (or any timeout-class rejection) map to `provider_unavailable`. Required because Cloudflare Workers do not impose a tight subrequest timeout, so an unbounded `fetch` to a hung provider leaves the client spinning forever — unreachable from the typed error path.
- **All `console.error` calls log only `{ code, status }` — never the source text, never the raw model response, never the request body.**

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- No source-text logging: `grep -rE "console\.(log|error|warn|info|debug).*source[_]?[Tt]ext" src/` returns nothing

#### Manual Verification:

- With a valid `OPENROUTER_API_KEY` in `.dev.vars`, a scratch script (or `npm run dev` + a temporary route) calling `generateProposals('<~500 chars of test text>')` returns a `Proposal[]` of 1–15 cards.
- With an empty/missing key, `generateProposals(...)` resolves to `{ data: null, error: { code: 'missing_api_key', ... } }` — no throw.
- A manual create through the existing dashboard form still saves with `source: 'manual'` after the schema change.
- With OpenRouter unreachable (block `openrouter.ai` in hosts file, or point the URL at a dead host), `generateProposals(...)` resolves to `{ data: null, error: { code: 'provider_unavailable', ... } }` within ~60s — no hang.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Generation API Route

### Overview

Expose `POST /api/flashcards/generate` as the single endpoint for proposal generation. The route authenticates via the existing Supabase session, validates the body with `generateFlashcardsSchema`, calls `generateProposals`, and returns either `{ proposals: Proposal[] }` on success or `{ error, code }` with the appropriate status code on failure. Middleware already covers the `/api/flashcards` prefix so no middleware change is required.

### Changes Required:

#### 1. Generation endpoint

**File**: `src/pages/api/flashcards/generate.ts`

**Intent**: Bridge the HTTP boundary to the AI service. Handle auth, validation, service invocation, and error mapping. Source text from the request body is passed straight to the service and discarded with the request scope — no logging, no DB write, no telemetry.

**Contract**:
- `POST` only (no `GET`); exports uppercase `POST` as `APIRoute`.
- `200 { proposals: Proposal[] }` on success.
- `400 { error: "Validation failed", issues: ZodIssue[] }` if the body fails `generateFlashcardsSchema`.
- `400 { error: "Invalid JSON body" }` if `request.json()` throws.
- `401 { error: "Unauthorized" }` if `context.locals.user` is null (middleware also enforces this; the explicit check is defence-in-depth and matches the existing pattern at `src/pages/api/flashcards/index.ts:32`).
- `500 { error: "Supabase is not configured" }` if `createClient` returns null (matches existing pattern even though this route doesn't query Supabase — keeps the auth contract uniform).
- `500 { error: "AI generation is not configured", code: "missing_api_key" }` when the service returns `missing_api_key`.
- `502 { error: "...", code: "provider_unavailable" | "invalid_model_output" | "empty_result" }` for service-level failures.
- The route handler does NOT include the source text in any response body or log line.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `curl -X POST http://localhost:4321/api/flashcards/generate -H "Cookie: <session>" -H "Content-Type: application/json" -d '{"source_text":"<long enough body>"}'` returns `200 { proposals: [...] }` with 1–15 cards.
- Unauthenticated request returns `401`.
- Body with `source_text` shorter than 200 chars returns `400` with a Zod issue on the `source_text` field.
- Body with `source_text` longer than 25,000 chars returns `400`.
- Body missing `source_text` entirely returns `400`.
- With `OPENROUTER_API_KEY` unset locally, the route returns `500 { code: "missing_api_key" }`.
- `wrangler tail` (or `astro dev` console) during a successful generation shows no occurrence of the submitted source text.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generate Page + React Island

### Overview

Add `/dashboard/generate` page and the `GenerateFlashcards` React island that owns the entire user-facing flow: paste form with live validation and char counter, animated progress indicator during generation, proposal list with inline edit/accept/reject, per-card save via the existing flashcard create endpoint, and an error banner with a "Retry" button that preserves the pasted text. Dashboard gets a new "Generate cards" link next to the existing "Review" link.

### Changes Required:

#### 1. Generate page

**File**: `src/pages/dashboard/generate.astro`

**Intent**: Astro shell that mirrors `src/pages/dashboard/review.astro:1` — page header, back-to-dashboard link, hosts the React island with `client:load`. Protected automatically by middleware.

**Contract**:
- Title: "Generate" (passed to `Layout`).
- Page heading: "Generate flashcards" with the same gradient styling as the review page.
- Subtitle: a short description ("Paste study material and let the AI propose flashcards. You decide what to keep.").
- Back link to `/dashboard`.
- `<GenerateFlashcards client:load />`.

#### 2. Generate React island

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: Owns the paste-generate-review cycle entirely client-side. Tracks UI state (`idle | generating | reviewing | error`), the textarea contents, the in-flight proposal list with per-proposal `original` and `current` text, and the saving state per proposal.

**Contract**:
- Constants: `MIN_CHARS = 200`, `MAX_CHARS = 25000`.
- Local state shape: `{ sourceText: string, state: 'idle' | 'generating' | 'reviewing' | 'error', proposals: ProposalState[], error: string | null }` where `ProposalState = { id, originalFront, originalBack, front, back, isSaving, savedId?: string }`.
- **Paste view (state ∈ {idle, generating, error}):** large `Textarea`, live `<charCount>/${MAX_CHARS}` indicator turning amber below 200 and red above 25,000; a primary "Generate" button disabled when char count is out of range or `state === 'generating'`; an inline progress indicator (animated spinner + text "Generating cards from your text…") shown while `state === 'generating'`; on `state === 'error'` the error banner sits above the textarea (the textarea content is preserved) with a "Retry" button that re-fires the same request.
- **Review view (state === 'reviewing'):** a header "Review proposals" with a counter ("3 cards remaining" — counts only un-acted-on proposals); each proposal rendered as a Card with editable `Input` (front) and `Textarea` (back) using the same character limits as `FlashcardForm.tsx` (front ≤1000, back ≤5000); three actions per proposal: **Accept** (compares trimmed `front`/`back` against `original*`, POSTs to `/api/flashcards` with `source: 'ai_full'` if unchanged, `'ai_edited'` if changed, removes the proposal on success), **Reject** (removes from list, no network), and an "Edit" affordance — since fields are already inline-editable, "Edit" is implicit; we only ship an `aria-label` clarifying the textboxes are editable.
- When the last proposal is acted upon, return to the paste view with an empty textarea and a success toast / inline message ("Saved N cards. Paste more text to generate again.").
- **Generate flow**: on submit, set `state: 'generating'`, POST to `/api/flashcards/generate`, on `200` map response proposals into `ProposalState[]` (originals = current at load) and set `state: 'reviewing'`; on non-2xx parse `{ error, code }` and set `state: 'error'` with a human-readable message keyed off `code` (e.g. `provider_unavailable` → "The AI service is temporarily unavailable. Please retry."); on network failure set `state: 'error'` with a generic message.
- **Accept flow**: per-proposal `isSaving` flag, POST `{ front, back, source }` to `/api/flashcards`, on `201` remove the proposal from the list, on non-2xx set a per-proposal error string ("Couldn't save — try again") without removing the proposal.
- **Privacy**: no proposal field, no source text, no model response is written to `localStorage` or `sessionStorage`. Errors from `/api/flashcards/generate` are shown verbatim from the `error` field but never echo the source text (the server-side contract guarantees this).
- Buttons follow the existing dashboard styling vocabulary used in `FlashcardList.tsx` (white primary, transparent outline secondary, destructive red for Reject).

#### 3. Dashboard "Generate cards" link

**File**: `src/pages/dashboard.astro`

**Intent**: Surface the generation flow alongside the existing "Review" link.

**Contract**: A new anchor `<a href="/dashboard/generate">Generate cards</a>` in the same header action row as the existing Review link, styled identically.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Pasting <200 chars disables the Generate button and shows the char-count indicator in amber.
- Pasting >25,000 chars disables the Generate button and shows the char-count indicator in red.
- Pasting valid-length text and clicking Generate shows the spinner with the progress label; the button is disabled while in-flight.
- On a successful generation, the proposal list renders 1–15 cards with editable front/back fields.
- Accepting an unedited proposal POSTs with `source: 'ai_full'` and removes the proposal from the list; the card appears on the dashboard list.
- Editing a proposal's front or back, then accepting it, POSTs with `source: 'ai_edited'`; the badge on the dashboard reads "AI edited".
- Rejecting a proposal removes it instantly with no network call (verify via Network panel).
- After all proposals are acted on, the view returns to the paste form.
- On a forced server error (temporarily invalidate the API key in `.dev.vars`), the error banner appears, the textarea still contains the pasted text, and clicking Retry re-runs the request.
- During a successful generation, `wrangler tail` or the dev server console shows no occurrence of the submitted source text.
- Visiting `/dashboard/generate` while logged out redirects to `/auth/signin`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before the plan is considered done.

---

## Testing Strategy

### Unit Tests:

- None planned. The repo has no test runner; consistent with S-01 and S-02.

### Integration Tests:

- None planned. Manual verification per phase is the gate.

### Manual Testing Steps:

1. **Privacy verification**: Open `wrangler tail` (or watch the `astro dev` console) and run a full generation cycle with a recognisable string in the source text. Confirm the string never appears in any log line, error payload, or response.
2. **Happy path**: Paste a ~1,000-char domain text, generate, edit one proposal, accept it (verify `source: 'ai_edited'` on the dashboard), accept another unedited (verify `source: 'ai_full'`), reject one, navigate to `/dashboard`, confirm the two accepted cards are present.
3. **Validation edges**: 199 chars rejected, 200 chars accepted, 25,000 chars accepted, 25,001 chars rejected.
4. **Error paths**: Empty `OPENROUTER_API_KEY` → `missing_api_key` UX; broken key → `provider_unavailable` UX; verify Retry preserves textarea contents.
5. **Auth**: Hit `/dashboard/generate` and `POST /api/flashcards/generate` while signed out — verify redirect + 401 respectively.
6. **RLS**: After accepting cards, sign in as a different user, confirm the cards are not visible.

## Performance Considerations

- The single OpenRouter call is the dominant latency cost (free-tier model latency can vary, typically several seconds for ~1,000-char input). We accept this and surface it via the progress indicator per the PRD NFR.
- Cloudflare Workers CPU time is **not** consumed while the Worker is awaiting `fetch()` to OpenRouter — wall-clock latency is fine, CPU budget is safe.
- Worker memory ceiling (128 MB) is not at risk: a 25,000-char input + a 15-card response is well under 1 MB.
- The proposal list re-renders on each accept/reject; with ≤15 items this is negligible and no memoisation is needed.
- **Per-card Accept**: each Accept fires its own `POST /api/flashcards`. With the 15-card cap and ~150–300 ms per request (Supabase auth + RLS-scoped insert), accepting an entire batch can be ~2–4 s of cumulative wall time if the user mashes Accept without pauses. This is an intentional MVP tradeoff for endpoint reuse and matches the PRD's "saved immediately" wording. Fast-follow: a `POST /api/flashcards/batch` endpoint plus client-side parallelisation if real usage shows this hurts.

## Migration Notes

- No database migration. The `flashcards` table is unchanged; the `source` column already accepts `'ai_full'` and `'ai_edited'`.
- New env var (`OPENROUTER_API_KEY`) must be set in `.dev.vars` for local dev and pushed to production via `npx wrangler secret put OPENROUTER_API_KEY` before the generation route works in production. The route degrades gracefully (`500 { code: "missing_api_key" }`) when the key is absent.

## References

- PRD: `context/foundation/prd.md` — US-01, FR-004, FR-005, FR-006, privacy NFR, generation-progress NFR.
- Roadmap: `context/foundation/roadmap.md` — S-03 entry, Stream B, open question on input bounds.
- Change identity: `context/changes/ai-flashcard-generation/change.md`.
- Infrastructure constraints: `context/foundation/infrastructure.md` — Workers memory + CPU limits, observability.
- Similar pattern (schema → service → API → island, three-phase plan): `context/changes/manual-flashcard-crud/plan.md`.
- Similar pattern (multi-phase island + dedicated dashboard sub-page): `context/changes/sr-review-session/plan.md`.
- Existing code references:
  - `src/lib/services/flashcard.service.ts:26` — `createFlashcard` (extending in Phase 1).
  - `src/lib/schemas/flashcard.schemas.ts:7` — `createFlashcardSchema` (extending in Phase 1).
  - `src/pages/api/flashcards/index.ts:30` — POST handler pattern reused for `generate.ts`.
  - `src/middleware.ts:5` — `/api/flashcards` prefix already covers `/api/flashcards/generate`.
  - `src/pages/dashboard/review.astro:1` — page scaffold mirrored by `generate.astro`.
  - `src/components/dashboard/FlashcardList.tsx:1` — fetch + state patterns reused.
  - `src/components/dashboard/FlashcardForm.tsx:31` — char-limit constants and validation patterns reused.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: AI Service Foundation

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — de9f8f9
- [x] 1.2 Linting passes: `npm run lint` — de9f8f9
- [x] 1.3 Build passes: `npm run build` — de9f8f9
- [x] 1.4 No source-text logging: `grep -rE "console\.(log|error|warn|info|debug).*source[_]?[Tt]ext" src/` returns nothing — de9f8f9

#### Manual

- [x] 1.5 With a valid OPENROUTER_API_KEY, generateProposals returns a Proposal[] of 1–15 cards — de9f8f9
- [x] 1.6 With an empty/missing key, generateProposals resolves to { error: { code: 'missing_api_key' } } without throwing — de9f8f9
- [x] 1.7 Manual create through the existing dashboard form still saves with source: 'manual' — de9f8f9
- [x] 1.8 With OpenRouter unreachable, generateProposals resolves to { error: { code: 'provider_unavailable' } } within ~60s — de9f8f9

### Phase 2: Generation API Route

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — e67e556
- [x] 2.2 Linting passes: `npm run lint` — e67e556
- [x] 2.3 Build passes: `npm run build` — e67e556

#### Manual

- [x] 2.4 Authenticated POST /api/flashcards/generate with valid body returns 200 { proposals: [...] } — e67e556
- [x] 2.5 Unauthenticated request returns 401 — e67e556
- [x] 2.6 source_text < 200 chars returns 400 with Zod issue — e67e556
- [x] 2.7 source_text > 25,000 chars returns 400 — e67e556
- [x] 2.8 Missing source_text returns 400 — e67e556
- [x] 2.9 With OPENROUTER_API_KEY unset, the route returns 500 { code: "missing_api_key" } — e67e556
- [x] 2.10 wrangler tail / dev console shows no occurrence of the submitted source text — e67e556

### Phase 3: Generate Page + React Island

#### Automated

- [x] 3.1 Type checking passes: `npx astro check`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build passes: `npm run build`

#### Manual

- [x] 3.4 Pasting <200 chars disables Generate and shows amber indicator
- [x] 3.5 Pasting >25,000 chars disables Generate and shows red indicator
- [x] 3.6 Generate shows spinner with progress label; button disabled while in-flight
- [x] 3.7 Successful generation renders 1–15 proposals with editable front/back
- [x] 3.8 Accepting unedited proposal POSTs with source: 'ai_full' and the card appears on the dashboard
- [x] 3.9 Editing then accepting POSTs with source: 'ai_edited'; dashboard badge reads "AI edited"
- [x] 3.10 Rejecting a proposal removes it with no network call
- [x] 3.11 After all proposals are acted on, the view returns to the paste form
- [x] 3.12 Forced server error shows the error banner with textarea preserved; Retry re-runs the request
- [x] 3.13 During a successful generation, no log line contains the submitted source text
- [x] 3.14 Visiting /dashboard/generate while logged out redirects to /auth/signin
