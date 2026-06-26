# AI Flashcard Generation — Plan Brief

> Full plan: `context/changes/ai-flashcard-generation/plan.md`

## What & Why

Ship roadmap slice S-03 (the AI differentiator from PRD US-01): a logged-in user pastes source text, triggers AI flashcard generation, and reviews proposals card-by-card — accepting, editing-then-accepting, or rejecting each one. This is the product wedge: if AI generation isn't good and frictionless, 10xCards is indistinguishable from a generic flashcard app.

## Starting Point

F-01 has landed the `flashcards` table with a `source` enum already accepting `'manual' | 'ai_full' | 'ai_edited'`. S-01 has shipped manual CRUD with the pattern stack we'll reuse: Zod schemas, service layer, JSON API routes, React island on the dashboard. No LLM integration exists today — no OpenRouter SDK, no env var, no AI route, no generation UI. The existing `POST /api/flashcards` hardcodes `source: 'manual'` and must be extended to accept the AI provenances.

## Desired End State

A user clicks "Generate cards" from `/dashboard`, lands on `/dashboard/generate`, pastes 200–25,000 chars, clicks Generate, watches an animated progress indicator while the server calls OpenRouter's free-tier `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` model, and gets back 1–15 editable proposals. Accept saves a card instantly (with `ai_full` or `ai_edited` based on whether the text was changed). Reject discards it client-side. On error, a clear banner appears with Retry — and the textarea preserves the pasted text. The source text is never persisted or logged.

## Key Decisions Made

| Decision                    | Choice                                                        | Why (1 sentence)                                                                                                          | Source |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| Source-text bounds          | 200–25,000 chars                                              | Covers notes through full articles; safe under Workers CPU/memory limits and free-tier OpenRouter testing.                | Plan   |
| LLM model                   | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` via OpenRouter (hardcoded) | Free-tier model verified with the local OpenRouter key; supports JSON-mode request shape and returned `usage.cost: 0`. | Plan   |
| Response shape              | Single JSON response (full proposal batch)                    | Simplest implementation; satisfies progress NFR via animated spinner; no SSE complexity in a Workers context.             | Plan   |
| Proposal count              | Adaptive up to 15 (model decides; server truncates)           | Short text → few cards (no padding); long text → meaningful coverage; cap protects the UI.                                | Plan   |
| Edit-vs-accept semantics    | Inline-editable proposals; Accept compares text → `ai_full` if unchanged, `ai_edited` if changed | Matches PRD US-01 three peer actions; preserves the 75%-accepted analytics signal; comparison done client-side. | Plan   |
| Save granularity            | Per-card POST `/api/flashcards` on Accept                     | Matches PRD "Accepted cards saved immediately"; reuses the existing endpoint; rejected proposals never reach the DB.      | Plan   |
| Error handling              | All-or-nothing with typed `{ error, code }` + preserved input | Simple mental model; one-click retry; source text is never echoed in error payloads.                                      | Plan   |
| Rate limiting               | None for MVP                                                  | Authenticated users only + 25k char ceiling + free-tier provider limits = acceptable MVP risk; can add KV-backed limits later. | Plan   |
| Navigation                  | Dedicated `/dashboard/generate` page                          | Mirrors `/dashboard/review`; gives generation its own focused surface without crowding the dashboard list.                | Plan   |

## Scope

**In scope:**

- New env var `OPENROUTER_API_KEY` wired into the Astro env schema.
- New Zod schemas (`ai-generation.schemas.ts`) and AI service (`ai-generation.service.ts`).
- Extension of `createFlashcardSchema` + `createFlashcard` to accept an explicit `source`.
- New API route `POST /api/flashcards/generate`.
- New page `/dashboard/generate` + `GenerateFlashcards.tsx` React island.
- Dashboard "Generate cards" link.

**Out of scope:**

- Streaming / SSE responses.
- Per-user rate limiting, in-flight locks, generation history.
- Persistence of source text, prompts, model responses, or rejected proposals (anywhere).
- Schema migrations (none needed).
- Model selection UI, prompt-tuning, multi-format input (PDF, URL, upload).
- Automated test runner (consistent with S-01, S-02 — repo has none).

## Architecture / Approach

Three phases mirroring the S-01 pattern: foundation → API → UI. Privacy is enforced top-down: the source text exists only in the inbound request and the OpenRouter `fetch` body; every error handler logs only `{ code, status }`.

```
GenerateFlashcards.tsx (state machine: idle → generating → reviewing → error)
       │                                    
       ├── POST /api/flashcards/generate ──> ai-generation.service ──> OpenRouter (free-tier Nemotron, JSON mode)
       │                                            │
       │                                            └── Zod-validate model output → Proposal[]
       │
       └── POST /api/flashcards (per Accept) ──> flashcard.service (existing) ──> Supabase (RLS-scoped)
```

The proposal-review island holds `(originalFront, originalBack, currentFront, currentBack)` per proposal — Accept compares the trimmed pairs to decide between `ai_full` and `ai_edited`.

## Phases at a Glance

| Phase                            | What it delivers                                                                                | Key risk                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. AI Service Foundation         | Env wiring, generation schemas, `ai-generation.service.ts`, `source` flowing through create     | Privacy discipline — must keep `console.error` calls free of source text and model body        |
| 2. Generation API Route          | `POST /api/flashcards/generate` with typed error codes                                          | Error mapping completeness — `provider_unavailable` / `invalid_model_output` / `empty_result`  |
| 3. Generate Page + React Island  | `/dashboard/generate` page, paste-generate-review flow, per-card save, error retry preserves input | Edit-vs-accept source labelling correctness (trim+compare); dashboard styling consistency      |

**Prerequisites:** F-01 (landed), S-01 (landed), a working `OPENROUTER_API_KEY` for manual verification (free OpenRouter tier suffices).
**Estimated effort:** ~1–2 sessions across the 3 phases.

## Open Risks & Assumptions

- Assumes OpenRouter's free-tier `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` is reliable enough at JSON mode to make `invalid_model_output` a rare error rather than the dominant failure mode. If it isn't, we'd add one bounded retry or move back to a paid model — flagged as a fast follow.
- Assumes the privacy NFR is binding on Cloudflare's observability logs too (the project has `observability.enabled: true` in `wrangler.jsonc`). The plan operationalises this by logging only `{ code, status }`, never the request body.
- Assumes `crypto.randomUUID()` is available in the Workers runtime (it is — standard Web Crypto API).
- Assumes the selected free-tier model returns at least 1 card for any 200+ char input that contains testable knowledge; if it returns zero, the user sees `empty_result` and is invited to retry with different text.
- No automated tests are added; manual verification per phase is the gate.

## Success Criteria (Summary)

- A logged-in user can paste 200–25,000 chars, generate proposals, and accept/edit/reject each one with accepted cards landing on the dashboard tagged `ai_full` or `ai_edited`.
- The source text never appears in any log, error payload, telemetry stream, or database row.
- On any failure mode, the user gets a clear error banner with the pasted text preserved and a Retry button that re-fires the request.
