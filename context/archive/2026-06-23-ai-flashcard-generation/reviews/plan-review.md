<!-- PLAN-REVIEW-REPORT -->
# Plan Review: AI Flashcard Generation

- **Plan**: `context/changes/ai-flashcard-generation/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: SOUND (one targeted fix recommended)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

10/10 paths ✓, 4/4 symbols ✓, brief↔plan ✓, progress↔phase ✓ (3 phases, 31 success-criteria bullets → 31 progress checkboxes).

## Findings

### F1 — No timeout on OpenRouter fetch; hung provider = forever spinner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1, step 6 (`ai-generation.service.ts` contract)
- **Detail**: The service POSTs to OpenRouter with bare `fetch(...)` and no AbortController. Workers don't impose a tight subrequest timeout (effectively several minutes), and OpenRouter occasionally hangs on `gpt-4o-mini` JSON-mode requests under load. A hung request yields an indefinite spinner client-side — none of the four error codes (`provider_unavailable`, `invalid_model_output`, `empty_result`, `missing_api_key`) fire, because the promise never resolves. The progress NFR ("visible progress indicator") is technically met, but the recovery story in End State item 8 ("clear error banner with Retry") is unreachable. The textarea is preserved across reloads only because the user hasn't navigated — a page refresh loses the pasted text.
- **Fix**: Wrap the OpenRouter fetch in an AbortController with a 60s timeout. On AbortError, map to `provider_unavailable`. Add a line under Phase 1 step 6 contract ("60-second client-side timeout via AbortController; aborts mapped to `provider_unavailable`") and a Phase 1 manual verification step ("Block openrouter.ai at the firewall, generate, see `provider_unavailable` error within ~60s").
  - Strength: One-line edit to the contract; uses a Web Standard API already available in Workers; turns the worst user-visible failure mode into the already-handled error path.
  - Tradeoff: 60s feels long; could be tuned to 45s. No real tradeoff vs. leaving it unbounded.
  - Confidence: HIGH — AbortController + fetch is standard, no new deps, no new error class needed beyond `provider_unavailable`.
  - Blind spot: 60s is a guess based on observed gpt-4o-mini p99 latency; the team may want to instrument and adjust.
- **Decision**: FIXED — added 60s AbortController to service contract (Phase 1, step 6), added manual verification step 1.8 ("OpenRouter unreachable → `provider_unavailable` within ~60s"), and matching Progress checkbox.

### F2 — Privacy guardrail relies on service never throwing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, step 6 + Phase 2 (route handler)
- **Detail**: The privacy NFR is enforced by "All `console.error` calls log only `{ code, status }`" plus a typed `GenerateResult` discriminated union. This implicitly requires that no code path in the service or route ever *throws* an Error with user text in `.message` — Cloudflare Workers logs uncaught throws as stack traces with the error message verbatim. The plan never says "no thrown Error contains source text or model response content" as an explicit rule, nor does it mandate a defensive top-level try/catch in the route handler.
- **Fix**: Add one line to Phase 1's Critical Implementation Details: "Privacy rule extends to thrown errors — no `throw new Error(...)` constructed from `sourceText`, response body, or model output; all such failure paths return typed `GenerationError` instead." Add a top-level try/catch to the Phase 2 route handler that maps any unexpected throw to a generic 500 logging only the error class name.
- **Decision**: FIXED — extended the Privacy enforcement bullet in Critical Implementation Details to cover thrown errors + mandate route-level try/catch logging only the error constructor name.

### F3 — Per-card POST on Accept; up to 15 sequential round-trips

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 (`GenerateFlashcards.tsx` — Accept flow)
- **Detail**: Each accept is a separate fetch to `POST /api/flashcards`. With 15 proposals all accepted, that's 15 sequential requests, each paying full Supabase auth + RLS cost (~150–300ms each). The PRD says "Accepted cards saved immediately" — per-card is consistent with that wording. The brief explicitly chose this for endpoint reuse. Calling it out so it's not silently a surprise during QA.
- **Fix**: None required for MVP. If observed latency feels poor, add a fast-follow batch endpoint (`POST /api/flashcards/batch`) and parallelize accepts client-side. Document as a known minor inefficiency.
- **Decision**: FIXED — documented as known MVP tradeoff with batch-endpoint fast-follow in Performance Considerations.

### F4 — System prompt content left to implementer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, step 6
- **Detail**: The contract describes the system prompt in prose ("extract testable knowledge units as `{ cards: [{ front, back }] }`, up to 15 entries, no preamble, no markdown") but doesn't include a draft prompt. Prompt quality is the dominant lever on whether the 75% acceptance metric is meetable, and on whether `invalid_model_output` stays rare. Different agents implementing this will produce materially different prompts.
- **Fix**: Add a short draft system prompt verbatim under Phase 1 step 6 ("Draft prompt — implementer may tune"). Include constraints: response is JSON only, no prose, no markdown, no code fences, schema shape, front ≤1000 / back ≤5000 char hints, language matches input.
- **Decision**: FIXED — verbatim draft system prompt added under Phase 1 step 6 with binding constraints (JSON only, schema, char limits, language, no hallucinations, empty-array fallback).
