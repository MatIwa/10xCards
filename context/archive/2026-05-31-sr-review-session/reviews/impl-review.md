<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Spaced Repetition Review Session

- **Plan**: context/changes/sr-review-session/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-01
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned dev artifact committed to supabase/snippets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/snippets/Untitled query 630.sql
- **Detail**: File is not in the plan. Contains a one-off `information_schema.columns` introspection query from Phase 1 manual verification (step 1.4). Default Supabase Studio name ("Untitled query 630") suggests accidental check-in rather than a curated dev tool.
- **Fix**: Delete the file. Query is trivially reproducible — standard `information_schema.columns where table_name='flashcards'` lookup.
- **Decision**: FIXED — file deleted.

### F2 — gradeCard: read-then-write without optimistic locking

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/review.service.ts:96-117
- **Detail**: `gradeCard` does SELECT (line 97) → compute next state → UPDATE (lines 104–110) as two separate round-trips. Concurrent grades on the same card (e.g. two tabs) will lose the first write. RLS prevents cross-user damage; risk within a user's session is bounded but real. Acceptable for MVP.
- **Fix**: Defer to follow-up. Natural fix is a Postgres RPC performing read+compute+update in one transaction, or `.update(...).eq("updated_at", original)` optimistic check.
- **Decision**: DEFERRED — queued in context/changes/sr-review-session/follow-ups/review-fixes.md.

### F3 — Type cast bypasses ts-fsrs `Card` type in serialize()

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/review.service.ts:34
- **Detail**: `serialize()` reads `elapsed_days` via `card as unknown as { elapsed_days: number }`. Double-cast bypasses ts-fsrs's `Card` type, suggesting that field is no longer a public type member on the installed version. Works at runtime but fragile across ts-fsrs upgrades.
- **Fix**: Drop the cast and read `card.elapsed_days` directly if the type allows; otherwise add a one-line comment explaining the cast and pin a compatibility note alongside the ts-fsrs version in package.json.
- **Decision**: FIXED — direct `card.elapsed_days` access; ts-fsrs `Card` type accepts it, no cast needed.

## Notes — checked but not findings

- `queue.ts` GET has no explicit `context.locals.user` check, but neither does `api/flashcards/index.ts` GET. Both rely on RLS. Consistent with repo pattern.
- Destructive migration (drops 3 columns + 3 constraints) was explicitly accepted in the plan: production table is empty; dev rows discarded via `db reset`.
- AGENTS.md hard rules respected: no `"use client"`, `cn()` used throughout, secrets via `astro:env/server`, `@/*` alias used everywhere, uppercase HTTP methods, Zod on every input.
- lessons.md rule (no Lodash) respected.
