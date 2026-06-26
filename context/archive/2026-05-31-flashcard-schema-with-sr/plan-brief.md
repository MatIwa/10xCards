# Flashcard Schema with SR Scheduling — Plan Brief

> Full plan: `context/changes/flashcard-schema-with-sr/plan.md`

## What & Why

Create the foundational `flashcards` database table with spaced repetition scheduling metadata so that all downstream features (manual CRUD, SR review sessions, AI generation) have a stable data layer to build on. This is foundation slice F-01 from the roadmap — without it, nothing else ships.

## Starting Point

The codebase has Supabase configured (client, auth, middleware) but zero database migrations. No application tables exist yet. Auth works (sign up, sign in, sign out) and the middleware protects `/dashboard`, but there's nothing to show on the dashboard.

## Desired End State

A `flashcards` table exists in Supabase with content fields, SM-2 scheduling metadata, source tracking (manual vs AI-generated), and per-user RLS policies. A matching TypeScript `Flashcard` type is available at `@/types` for all downstream consumers.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Source tracking granularity | Enum: manual / ai_full / ai_edited | Enables the 75% acceptance metric without over-engineering |
| SR algorithm columns | SM-2 family (interval, ease_factor, repetitions, next_review_at) | Widest library compatibility; well-documented standard |
| Deletion strategy | Hard delete only | Simpler schema and queries; cards are cheap to recreate in MVP |
| TypeScript types location | Hand-written `src/types.ts` | Matches AGENTS.md convention; single source of truth |

## Scope

**In scope:**
- SQL migration creating `flashcards` table with all columns, constraints, indexes
- RLS policies (SELECT, INSERT, UPDATE, DELETE) scoped to owning user
- `updated_at` auto-update trigger
- `src/types.ts` with `Flashcard` interface and `FlashcardSource` type

**Out of scope:**
- API routes (S-01)
- Zod validation schemas (S-01)
- UI components
- Seed data
- Supabase-generated types

## Architecture / Approach

Single PostgreSQL table `public.flashcards` with a FK to `auth.users`. RLS enforces isolation at the database level — no application-layer filtering needed. SM-2 state is stored as flat columns (not JSONB) for queryability. A composite index on `(user_id, next_review_at)` optimizes the "cards due for review" query that S-02 will use.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database Schema & RLS | Migration with table, indexes, RLS policies, trigger | First migration — no prior pattern to follow; verify with `supabase db reset` |
| 2. TypeScript Types | `src/types.ts` with Flashcard entity type | Minimal risk — pure type definitions |

**Prerequisites:** Local Supabase running (`npx supabase start`, requires Docker)
**Estimated effort:** ~1 session, 2 phases

## Open Risks & Assumptions

- SM-2 columns assume we'll use an SM-2-compatible library in S-02; if FSRS is chosen later, column rename migration needed
- `next_review_at` defaults to `now()` so new cards appear in the first review session immediately — this is intentional

## Success Criteria (Summary)

- `npx supabase db reset` applies the migration without errors
- RLS blocks cross-user access at the database level
- `npx astro check` and `npm run lint` pass with the new types file
