# Flashcard Schema with SR Scheduling — Implementation Plan

## Overview

Create the foundational flashcard table in Supabase with spaced repetition scheduling metadata (SM-2 family), source tracking, and RLS policies enforcing per-user isolation. Define matching TypeScript types. This is foundation slice F-01 — all downstream features (manual CRUD, SR review, AI generation) depend on it.

## Current State Analysis

- No migrations exist — `supabase/migrations/` is empty; this is the first migration.
- Supabase client (`src/lib/supabase.ts`) uses `@supabase/ssr` with server-only secrets via `astro:env/server`.
- Auth middleware (`src/middleware.ts`) populates `context.locals.user` with a Supabase `User` object whose `.id` is the UUID used for ownership.
- No `src/types.ts` file exists; `src/env.d.ts` only declares `App.Locals`.
- AGENTS.md convention: migration files named `YYYYMMDDHHmmss_short_description.sql`.

### Key Discoveries:

- `supabase/config.toml` uses PostgreSQL 17, migrations enabled, seed file at `./seed.sql`
- The project has no Zod dependency yet (noted in roadmap baseline) — validation is a concern for S-01, not this slice
- RLS must be enabled immediately per AGENTS.md hard rule

## Desired End State

A `flashcards` table exists in Supabase with:
- Content fields (front, back)
- Source tracking (manual | ai_full | ai_edited)
- SM-2 scheduling metadata (interval, ease_factor, repetitions, next_review_at)
- Per-user isolation via `user_id` FK to `auth.users`
- RLS policies granting SELECT/INSERT/UPDATE/DELETE only to the owning user
- Indexes on `user_id` and `(user_id, next_review_at)` for review queries

Verification: `npx supabase db reset` applies the migration cleanly; `src/types.ts` exports a `Flashcard` type that mirrors the table columns.

## What We're NOT Doing

- No API routes — those come in S-01 (manual CRUD)
- No Zod schemas — validation layer deferred to S-01
- No seed data — empty table is fine for now
- No generated Supabase types (`supabase gen types`) — hand-written types are the convention per decision
- No UI — no pages, no components

## Implementation Approach

Two sequential phases: first land the migration (database is the source of truth), then define TypeScript types that match. Keeping them separate means the migration can be verified independently via `supabase db reset` before the app code references the new table.

## Phase 1: Database Schema & RLS

### Overview

Create the SQL migration with the flashcards table, check constraint for source enum, SM-2 columns with sensible defaults, indexes, and granular RLS policies.

### Changes Required:

#### 1. Flashcard table migration

**File**: `supabase/migrations/20260531120000_create_flashcards.sql`

**Intent**: Define the `flashcards` table with content, source tracking, SM-2 scheduling metadata, timestamps, and ownership. Enable RLS with per-operation policies.

**Contract**:

Table `public.flashcards` with columns:
- `id` — UUID PK, default `gen_random_uuid()`
- `user_id` — UUID NOT NULL, FK to `auth.users(id)` ON DELETE CASCADE
- `front` — TEXT NOT NULL (max 1000 chars via CHECK)
- `back` — TEXT NOT NULL (max 5000 chars via CHECK)
- `source` — TEXT NOT NULL DEFAULT 'manual', CHECK IN ('manual', 'ai_full', 'ai_edited')
- `interval` — INTEGER NOT NULL DEFAULT 0 (days until next review)
- `ease_factor` — REAL NOT NULL DEFAULT 2.5 (SM-2 starting ease)
- `repetitions` — INTEGER NOT NULL DEFAULT 0
- `next_review_at` — TIMESTAMPTZ NOT NULL DEFAULT now() (new cards are immediately reviewable)
- `created_at` — TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` — TIMESTAMPTZ NOT NULL DEFAULT now()

Indexes:
- `idx_flashcards_user_id` on `(user_id)`
- `idx_flashcards_user_next_review` on `(user_id, next_review_at)` — for "cards due for review" queries

RLS policies (table-level `ENABLE ROW LEVEL SECURITY`):
- `flashcards_select_own`: SELECT WHERE `auth.uid() = user_id`
- `flashcards_insert_own`: INSERT WITH CHECK `auth.uid() = user_id`
- `flashcards_update_own`: UPDATE USING `auth.uid() = user_id` WITH CHECK `auth.uid() = user_id`
- `flashcards_delete_own`: DELETE USING `auth.uid() = user_id`

Trigger: `updated_at` auto-updates on row modification via a `moddatetime`-style trigger or a simple `BEFORE UPDATE` function.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- No SQL syntax errors in the migration file

#### Manual Verification:

- Table visible in Supabase Studio (local) with correct columns and types
- RLS policies listed in Studio under the table's Policies tab
- Inserting a row via SQL editor with a valid `user_id` succeeds; inserting with a different user's ID is rejected by RLS

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: TypeScript Types

### Overview

Create `src/types.ts` with the Flashcard entity type and a source enum, matching the database schema exactly.

### Changes Required:

#### 1. Flashcard entity types

**File**: `src/types.ts`

**Intent**: Define the TypeScript representation of the `flashcards` table for use across API routes, services, and components. Export a `Flashcard` type (full row) and a `FlashcardSource` type (the source enum values).

**Contract**:

- `FlashcardSource` — union type `'manual' | 'ai_full' | 'ai_edited'`
- `Flashcard` — interface with all table columns typed (id: string, user_id: string, front: string, back: string, source: FlashcardSource, interval: number, ease_factor: number, repetitions: number, next_review_at: string, created_at: string, updated_at: string)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Types are importable from `@/types` in any `src/` file

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- N/A for this slice — no application logic, only schema and types

### Integration Tests:

- Migration applies and rolls back cleanly (`supabase db reset`)
- RLS blocks cross-user access (verifiable via SQL in Supabase Studio or a future integration test)

### Manual Testing Steps:

1. Run `npx supabase db reset` — confirm no errors
2. Open Supabase Studio (localhost:54323), navigate to the `flashcards` table
3. Confirm all columns, types, defaults, and constraints match the plan
4. Insert a test row via SQL editor, confirm `updated_at` trigger fires on UPDATE
5. Verify RLS: query as one user, confirm another user's rows are invisible

## Performance Considerations

- Composite index `(user_id, next_review_at)` supports the primary review query pattern: "fetch cards due for this user ordered by review date"
- No full-text search index needed at this stage — card lookup is always scoped by `user_id`

## Migration Notes

- First migration ever — no existing data to worry about
- `ON DELETE CASCADE` on `user_id` FK means deleting a Supabase auth user automatically removes their cards

## References

- Roadmap slice F-01: `context/foundation/roadmap.md`
- SM-2 algorithm reference: interval/ease_factor/repetitions are the standard SuperMemo-2 state variables
- Supabase RLS docs: https://supabase.com/docs/guides/database/postgres/row-level-security

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database Schema & RLS

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 5f9d6b2
- [x] 1.2 No SQL syntax errors in the migration file — 5f9d6b2

#### Manual

- [x] 1.3 Table visible in Supabase Studio with correct columns and types — 5f9d6b2
- [x] 1.4 RLS policies listed and functioning correctly — 5f9d6b2
- [x] 1.5 Cross-user access rejected by RLS — 5f9d6b2

### Phase 2: TypeScript Types

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — d8d1a54
- [x] 2.2 Linting passes: `npm run lint` — d8d1a54

#### Manual

- [x] 2.3 Types importable from `@/types` in any src/ file — d8d1a54
