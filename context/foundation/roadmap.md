---
project: "10xCards"
version: 1
status: draft
created: 2026-05-31
updated: 2026-06-24
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Creating flashcards manually discourages learners from using spaced repetition — one of the most effective retention methods. 10xCards uses AI to generate SRS-ready cards from pasted text, making card creation effortless. The product wedge — the one trait that, if removed, makes the product indistinguishable from a generic flashcard app — is AI generation quality good enough that 75% of proposed cards are accepted without heavy edits.

## North star

**S-02: SR review session** — user can start a spaced repetition review, answer cards, and rate recall to schedule next reviews.

> The north star (the smallest end-to-end slice whose successful delivery proves the product works — placed as early as Prerequisites allow because everything else only matters if this works): if the review loop doesn't feel right, neither AI generation nor manual creation matter — users need to trust the "when to review" promise before they'll invest in "what to learn."

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | flashcard-schema-with-sr | (foundation) flashcard table with SR metadata and RLS policies landed | — | FR-007, FR-011 | ready |
| S-01 | manual-flashcard-crud | create, view, edit, and delete flashcards | F-01 | FR-007, FR-008, FR-009, FR-010 | proposed |
| S-02 | sr-review-session | start a review session, answer cards, and rate recall | F-01, S-01 | FR-011, FR-012, FR-013 | proposed |
| S-03 | ai-flashcard-generation | paste text, trigger AI generation, accept/edit/reject proposals | F-01 | US-01, FR-004, FR-005, FR-006 | proposed |
| S-04 | account-deletion-gdpr | permanently delete their account and all personal data (GDPR right to erasure) | F-01 | FR-014 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Core review loop | `F-01` → `S-01` → `S-02` | Shortest dependency chain to north star; speed goal means this ships first. |
| B | AI differentiator | `S-03` | Parallel with Stream A after `F-01` lands; delivers the product wedge. |
| C | Compliance | `S-04` | GDPR right to erasure for EU users; parallel with Streams A/B after `F-01` lands. |

## Baseline

What's already in place in the codebase as of 2026-05-31 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 islands, shadcn/ui (new-york), Tailwind 4, file-based routing (`src/pages/`)
- **Backend / API:** partial — Astro SSR + 3 auth route handlers (`src/pages/api/auth/`); no request validation (Zod absent)
- **Data:** partial — Supabase client (`@supabase/ssr`) + `supabase/config.toml`; no migrations, no seeds
- **Auth:** present — Supabase auth, cookie-based sessions, route-level middleware protecting `/dashboard` (`src/middleware.ts`). Satisfies FR-001, FR-002, FR-003.
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`), CI/CD (`.github/workflows/ci.yml`), `npx wrangler deploy`
- **Observability:** absent — no logging, error tracking, or metrics

## Foundations

### F-01: Flashcard data schema with SR scheduling

- **Outcome:** (foundation) flashcard table with front/back content, source tracking, and SR scheduling metadata (next review date, interval, ease factor, repetitions) landed in Supabase with RLS policies enforcing per-user isolation.
- **Change ID:** flashcard-schema-with-sr
- **PRD refs:** FR-007, FR-011 (schema enables both manual creation and SR scheduling)
- **Unlocks:** S-01, S-02, S-03
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** SR metadata columns must accommodate the chosen SR library; designing for SM-2 family (interval + ease_factor + repetitions) covers the most common open-source options and minimizes rework.
- **Status:** ready

## Slices

### S-01: Manual flashcard CRUD

- **Outcome:** user can create a flashcard (front and back), view all their flashcards, edit an existing flashcard, and delete a flashcard.
- **Change ID:** manual-flashcard-crud
- **PRD refs:** FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** F-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced before the north star because SR review requires cards to exist; this is the shortest path to a populated deck and unblocks S-02.
- **Status:** proposed

### S-02: Spaced repetition review session

- **Outcome:** user can start a spaced repetition review session, see a card's front, reveal the back, rate their recall, and have the next review date scheduled automatically.
- **Change ID:** sr-review-session
- **PRD refs:** FR-011, FR-012, FR-013
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - What recall rating granularity (binary / 3-level / 5-level)? Depends on chosen SR library. — Owner: tech decision at `/10x-plan` time. Block: no.
- **Risk:** North star slice — validates the "when to review" promise. Placed after S-01 because review without cards is meaningless; SR library integration is the technical risk, mitigated by PRD non-goal (ready-made library, no custom algorithm).
- **Status:** proposed

### S-03: AI flashcard generation

- **Outcome:** user can paste source text, trigger AI flashcard generation, review a list of AI-generated proposals, and accept, edit, or reject each card individually — with accepted cards saved to their collection immediately.
- **Change ID:** ai-flashcard-generation
- **PRD refs:** US-01, FR-004, FR-005, FR-006
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - Source text input boundaries (min/max character count)? — Owner: user. Block: no.
- **Risk:** Depends on external LLM provider (OpenRouter); latency and cost are runtime risks. Privacy NFR (source text not retained after generation) must be enforced at implementation. Parallel to Stream A so neither track blocks the other.
- **Status:** proposed

### S-04: Account deletion (GDPR)

- **Outcome:** user can permanently delete their account from a settings/profile area; the action requires explicit confirmation, then wipes all personal data (flashcards, profile, Supabase auth record) and signs the user out. Satisfies the GDPR Article 17 right to erasure for EU users.
- **Change ID:** account-deletion-gdpr
- **PRD refs:** FR-014
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-03
- **Blockers:** —
- **Unknowns:**
  - Where the "Delete account" entry point lives (settings page vs. profile menu) — Owner: tech decision at `/10x-plan` time. Block: no.
  - Whether deletion calls `auth.admin.deleteUser` from a server endpoint with the service-role key, or relies on a Supabase database trigger from a user-initiated row deletion — Owner: tech decision at `/10x-plan` time. Block: no.
- **Risk:** Erasure must be complete and irreversible — partial deletes (e.g., orphaned flashcards after auth-user removal) would breach GDPR. Mitigation: rely on `ON DELETE CASCADE` from `flashcards.user_id` → `auth.users.id` so a single auth-user delete cleans all owned rows; add a verification check in the deletion endpoint. Service-role key must stay server-side only.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | flashcard-schema-with-sr | Flashcard table with SR metadata + RLS | yes | Run `/10x-plan flashcard-schema-with-sr` |
| S-01 | manual-flashcard-crud | Manual flashcard CRUD (create, view, edit, delete) | no | Awaits F-01 |
| S-02 | sr-review-session | Spaced repetition review session | no | Awaits F-01, S-01 |
| S-03 | ai-flashcard-generation | AI flashcard generation from pasted text | no | Awaits F-01; parallel with S-01 |
| S-04 | account-deletion-gdpr | Account deletion with full data erasure (GDPR) | no | Awaits F-01; parallel with S-01, S-02, S-03 |

## Open Roadmap Questions

1. **What are the source text input boundaries (min/max chars)?** — Owner: user. Block: S-03 (non-blocking — can ship with reasonable default, but explicit bounds should be confirmed).
2. **What recall rating granularity does the review use?** — Owner: tech decision (SR library choice). Block: S-02 (non-blocking — downstream decision during `/10x-plan`).
3. **What defines "heavily edited" for the 75% acceptance metric?** — Owner: user. Block: roadmap-wide (non-blocking — post-launch analytics decision).

## Parked

- **Custom SR algorithm** — Why parked: PRD §Non-Goals. Use a ready-made library; scheduling R&D is out of scope.
- **Multi-format import (PDF, DOCX, URL)** — Why parked: PRD §Non-Goals. MVP is paste-only.
- **Sharing / collaboration** — Why parked: PRD §Non-Goals. Cards are private per user.
- **Mobile / desktop apps** — Why parked: PRD §Non-Goals. Web only.
- **Offline-first / PWA** — Why parked: PRD §Non-Goals. Requires connectivity.
- **Observability infrastructure** — Why parked: no PRD NFR requires it for launch; baseline absent; speed goal deprioritizes non-user-facing infra.

## Done

(Empty on first generation. `/10x-archive` appends entries here when a change is archived.)
