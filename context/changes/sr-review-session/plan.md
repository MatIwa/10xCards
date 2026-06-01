# Spaced Repetition Review Session Implementation Plan

## Overview

Replace F-01's SM-2 memory columns on `flashcards` with FSRS columns, wire `ts-fsrs` into a server-side review service, expose due/grade API endpoints, and ship a `ReviewSession` React island on `/dashboard/review` so a logged-in user can pull a queue of due cards, reveal the back, rate recall on the 4-level Again/Hard/Good/Easy scale, and have the next review scheduled automatically.

## Current State Analysis

- `flashcards` table ([supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql)) encodes **SM-2** memory state (`interval`, `ease_factor`, `repetitions`, `next_review_at`). Table is empty in production; only dev rows exist.
- `Flashcard` type ([src/types.ts](../../../src/types.ts)) mirrors the SM-2 columns; consumed only by the manual-CRUD service.
- `flashcard.service.ts` ([src/lib/services/flashcard.service.ts](../../../src/lib/services/flashcard.service.ts)) writes only `front`/`back`/`source`/`user_id` and updates only `{ front, back }` — never reads or writes SR columns. Renaming SR columns will NOT break S-01.
- `middleware.ts` ([src/middleware.ts](../../../src/middleware.ts)) already auth-gates `/dashboard` (page redirect) and `/api/flashcards/*` (JSON 401). New review page + endpoints inherit this with zero new config.
- RLS policies on `flashcards` enforce per-user isolation ([migration:32–58](../../../supabase/migrations/20260531120000_create_flashcards.sql)); the FSRS due-cards query (`where user_id = auth.uid() and due <= now()`) is covered as-is.
- Composite index `idx_flashcards_user_next_review (user_id, next_review_at)` exists — it must be rebuilt against the renamed `due` column.
- No SR library is installed yet. `ts-fsrs` is pure-ESM, zero-dep, edge-safe (verified in [research.md §1](research.md)).
- Dashboard ([src/pages/dashboard.astro](../../../src/pages/dashboard.astro)) currently has the manual CRUD list ([src/components/dashboard/FlashcardList.tsx](../../../src/components/dashboard/FlashcardList.tsx)); no review entry point exists.

### Key Discoveries

- FSRS requires exactly 4 ratings — closes roadmap S-02 open question on granularity ([research.md §5](research.md)).
- `Card` rehydration is a 1:1 column → field mapping; `Date` ↔ ISO strings round-trip via Supabase `timestamptz` ([ts-fsrs-docs.md §2, §5](ts-fsrs-docs.md)).
- `scheduler.repeat(card, now)` returns all 4 outcomes; perfect for rendering per-button interval previews without committing state ([ts-fsrs-docs.md §1 "Preview vs commit"](ts-fsrs-docs.md)).
- `createEmptyCard()` produces `state=0`, `due=now()`, `stability=0`, `difficulty=0`, etc. — these are exactly the migration defaults, so any existing row "becomes new" under FSRS without manual data migration.

## Desired End State

- A logged-in user navigates from `/dashboard` to `/dashboard/review`, sees the front of the next due card, clicks "Show answer," sees the back plus 4 rating buttons each labelled with the next interval, picks one, and the next card appears (or an empty state if the queue is exhausted).
- When nothing is due, the user can opt into a "Practice anyway" session over their own cards that does NOT mutate scheduling state.
- `flashcards` table carries FSRS memory state; `npm run build`, `npm run lint`, and CI pass.

Verification: visit `/dashboard/review` with two seeded due cards; rate one Good → it leaves the queue; rate one Again → it stays scheduled in the learning step. Check Supabase: row's `state`, `stability`, `difficulty`, `due`, `last_review`, `reps` update.

## What We're NOT Doing

- Not creating a `review_logs` table or `user_settings` table — both deferred per research recommendation.
- Not exposing FSRS parameters to the user — hardcoded singleton in MVP.
- Not building deck/tag filtering — queue is all due cards for the user.
- Not adding analytics, streaks, or progress dashboards.
- Not migrating live data: production table is empty; existing dev rows are discarded by `db reset`.
- Not editing the F-01 migration file in-place (Supabase migration immutability).
- Not touching `flashcard.service.ts` logic beyond the unavoidable `Flashcard` type drift.

## Implementation Approach

Follow the codebase's "migration first, types after, service before API, API before UI" sequencing established by F-01 and S-01. Hardcode the FSRS scheduler as a module-level singleton in `review.service.ts` (analog to how `flashcard.service.ts` is shaped). Reuse middleware-driven auth — the review service trusts `auth.uid()` via RLS for reads and uses `.eq("user_id", userId)` defense-in-depth on writes, matching the existing service pattern.

## Critical Implementation Details

- **Migration ordering**: The new migration must drop the old composite index BEFORE dropping the `next_review_at` column, then recreate it against `due` AFTER the column rename. Postgres won't auto-rebuild it.
- **Empty-queue practice mode** must read a bounded sample (e.g., 20 cards, ordered by `last_review NULLS LAST, due asc`) but the grade endpoint must REFUSE to mutate when invoked in practice mode — enforce by a request-body flag, validated server-side. Practice reviews never write back.

## Phase 1: Schema migration & types

### Overview

Land a forward-only migration replacing SM-2 columns with FSRS columns and update the shared `Flashcard` type to match. Reset local Supabase to apply.

### Changes Required

#### 1. New Supabase migration

**File**: `supabase/migrations/<ts>_flashcards_fsrs.sql` (use current UTC timestamp, e.g., `20260601120000_flashcards_fsrs.sql`)

**Intent**: Replace SM-2 SR columns on `flashcards` with the FSRS memory-state columns required by `ts-fsrs`, rename `next_review_at` → `due`, and rebuild the per-user "due cards" index. Defaults match `createEmptyCard()` so any existing row behaves as a brand-new card.

**Contract**:
- DROP index `idx_flashcards_user_next_review`.
- ALTER TABLE drop columns: `interval`, `ease_factor`, `repetitions`. Drop constraints `flashcards_interval_non_negative`, `flashcards_repetitions_non_negative`, `flashcards_ease_factor_positive`.
- RENAME `next_review_at` → `due` (preserves NOT NULL + default `now()`).
- ADD columns (all NOT NULL with defaults): `stability double precision default 0`, `difficulty double precision default 0`, `elapsed_days integer default 0`, `scheduled_days integer default 0`, `learning_steps integer default 0`, `reps integer default 0`, `lapses integer default 0`, `state smallint default 0`, `last_review timestamptz` (nullable, no default).
- ADD constraint `flashcards_state_valid CHECK (state between 0 and 3)`.
- CREATE INDEX `idx_flashcards_user_due` ON `flashcards (user_id, due)`.
- End with `notify pgrst, 'reload schema';` (matches F-01 pattern).

#### 2. Update shared types

**File**: `src/types.ts`

**Intent**: Mirror the new `flashcards` columns so the manual-CRUD service and the new review service share a single source of truth.

**Contract**: Replace `interval`, `ease_factor`, `repetitions`, `next_review_at` on the `Flashcard` interface with `due: string`, `stability: number`, `difficulty: number`, `elapsed_days: number`, `scheduled_days: number`, `learning_steps: number`, `reps: number`, `lapses: number`, `state: 0 | 1 | 2 | 3`, `last_review: string | null`. Keep `id`, `user_id`, `front`, `back`, `source`, `created_at`, `updated_at` unchanged.

### Success Criteria

#### Automated Verification

- `npx supabase db reset` applies cleanly with no errors.
- `npm run build` succeeds (catches `Flashcard` type drift in any callsite).
- `npm run lint` passes.

#### Manual Verification

- After reset, `select column_name from information_schema.columns where table_name='flashcards'` returns the new FSRS columns and no SM-2 columns.
- `select * from pg_indexes where tablename='flashcards'` shows `idx_flashcards_user_due`.
- Manual CRUD on `/dashboard` still works end-to-end (create, list, delete one flashcard).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Review service & scheduler

### Overview

Install `ts-fsrs`, add a Zod schema for the rating, and create a service module wrapping the scheduler with `listDueCards`, `listPracticeCards`, `previewRatings`, and `gradeCard`.

### Changes Required

#### 1. Install dependency

**File**: `package.json` (via npm)

**Intent**: Add `ts-fsrs` to runtime deps.

**Contract**: `npm install ts-fsrs` — verify it lands in `dependencies` (not devDependencies).

#### 2. Rating schema

**File**: `src/lib/schemas/review.schemas.ts` (new)

**Intent**: Validate POST body for the grade endpoint; expose enum used by the React island.

**Contract**: Export `gradeReviewSchema = z.object({ rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) })` mapping to `Rating.Again|Hard|Good|Easy`. Export inferred type `GradeReviewInput`.

#### 3. Review service

**File**: `src/lib/services/review.service.ts` (new)

**Intent**: Encapsulate all `ts-fsrs` calls server-side. Module-level singleton scheduler with hardcoded defaults; no per-user parameters.

**Contract**:
- Module-level `const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true })`.
- `rehydrate(row: Flashcard): Card` — maps row columns to `ts-fsrs` `Card` (dates → `new Date(...)`, `state` cast to `State`, `last_review` undefined when null).
- `serialize(card: Card): Partial<Flashcard>` — inverse mapping, dates → ISO strings, `last_review` → null when undefined.
- `listDueCards(supabase): Promise<DataResult<Flashcard[]>>` — selects `*` where `due <= now()` ordered `due asc`. RLS handles user isolation.
- `listPracticeCards(supabase, limit = 20): Promise<DataResult<Flashcard[]>>` — selects `*` ordered `last_review nulls last, due asc` limited; no `due` filter.
- `previewRatings(row: Flashcard, now = new Date()): { again: Date; hard: Date; good: Date; easy: Date }` — calls `scheduler.repeat(rehydrate(row), now)` and extracts `card.due` per rating.
- `gradeCard(supabase, id: string, userId: string, rating: Rating): Promise<DataResult<Flashcard>>` — fetches row by id+user (returns `"Flashcard not found"` if missing), calls `scheduler.next(rehydrate(row), new Date(), rating)`, updates row with `serialize(next)` via `.update(...).eq("id", id).eq("user_id", userId).select("*").maybeSingle()`. Follows the `{ data, error }` shape used by `flashcard.service.ts`.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds.
- `npm run lint` passes.
- `npm ls ts-fsrs` shows the package installed.

#### Manual Verification

- Quick REPL/script (or paste into a temporary Astro page during dev): pass a fake row through `rehydrate` → `scheduler.next(_, _, Rating.Good)` → `serialize` round-trips cleanly with no NaN/undefined surprises.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: API routes

### Overview

Expose two endpoints under `/api/flashcards/`: a GET that returns the review queue (due or practice mode), and a POST that grades a single card. Both inherit middleware auth.

### Changes Required

#### 1. Queue endpoint

**File**: `src/pages/api/flashcards/review/queue.ts` (new)

**Intent**: Return the user's review queue. `mode=due` (default) → cards with `due <= now()`. `mode=practice` → bounded sample for "Practice anyway" UX. Each item is augmented with the 4 rating-preview `due` ISO strings so the UI can label buttons.

**Contract**:
- `export const prerender = false;`
- `export async function GET({ locals, url }): Promise<Response>` — read `mode` query param (`"due" | "practice"`, default `"due"`); validate with Zod inline. Use `locals.supabase` (or create via existing pattern). Call `listDueCards` or `listPracticeCards`. For each row, call `previewRatings` and shape response items as `{ ...flashcard, preview: { again, hard, good, easy } }` (ISO strings). Return `Response.json({ data, mode }, { status: 200 })`. On service error → `Response.json({ error }, { status: 500 })`.

#### 2. Grade endpoint

**File**: `src/pages/api/flashcards/[id]/review.ts` (new)

**Intent**: Apply a rating to one card. Refuses to mutate in practice mode.

**Contract**:
- `export const prerender = false;`
- `export async function POST({ locals, params, request }): Promise<Response>` — parse `params.id` (UUID; validate with Zod), parse JSON body with `gradeReviewSchema`, optional `practice: boolean` flag in body. If `practice === true` → return `Response.json({ data: null, skipped: true }, { status: 200 })` WITHOUT calling service. Otherwise call `gradeCard(supabase, id, userId, rating as Rating)`. Map service errors: `"Flashcard not found"` → 404, anything else → 500. On success → 200 with `{ data: updatedFlashcard }`.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds.
- `npm run lint` passes.

#### Manual Verification

- With dev server: `GET /api/flashcards/review/queue` while logged in returns due cards with `preview` field; while logged out returns 401 (proves middleware coverage).
- `POST /api/flashcards/<id>/review` with `{ rating: 3 }` mutates the row in Supabase (verify `state`, `due`, `reps` changed).
- `POST` with `{ rating: 3, practice: true }` returns `skipped: true` and the row is unchanged.
- `POST` with `{ rating: 7 }` returns a Zod validation error (400-equivalent).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Review page & React island

### Overview

Add a `/dashboard/review` Astro page hosting a `ReviewSession` React island that pulls the queue, walks the user through cards (front → reveal back → 4 rating buttons with interval preview), and handles the empty-state with a "Practice anyway" CTA. Link to it from the dashboard topbar.

### Changes Required

#### 1. Review page

**File**: `src/pages/dashboard/review.astro` (new)

**Intent**: Server-rendered page that hosts the `ReviewSession` island and inherits middleware auth. No data fetching on the server — the island handles its own queue load so it can transition modes (due → practice) without page navigation.

**Contract**: Uses `Layout` like `dashboard.astro`. Renders `<ReviewSession client:load />`. Optional page heading "Review".

#### 2. Review session island

**File**: `src/components/dashboard/ReviewSession.tsx` (new)

**Intent**: Interactive review loop. Fetches queue on mount, displays one card at a time with reveal-back flow and 4 rating buttons, posts the rating, advances to the next card, and shows an empty state with a "Practice anyway" button.

**Contract**:
- States: `loading | reviewing | revealed | submitting | empty | practiceEmpty | error`.
- On mount: `GET /api/flashcards/review/queue?mode=due`. If empty → `empty` state.
- Empty state shows "All caught up!" + button "Practice anyway" that re-fetches with `mode=practice` and enters `reviewing` with `practiceMode: true`.
- When `practiceMode` is true, the queue exhaustion state is `practiceEmpty` (just "Done — back to dashboard").
- Current-card view: shows `front`. After clicking "Show answer" → shows `back` + 4 buttons labeled `Again`, `Hard`, `Good`, `Easy` each with a small subtitle showing the relative interval derived from `card.preview.<rating>` (use `Intl.RelativeTimeFormat` against `new Date()` for human-friendly "in 4d").
- Rating click → POST `/api/flashcards/<id>/review` with `{ rating, practice: practiceMode }`. On success: advance index, reset reveal. On error: enter `error` state with retry.
- Keyboard shortcuts: `Space` reveals back; `1`/`2`/`3`/`4` pick rating once revealed (matches Anki conventions, helps WCAG keyboard-nav NFR).
- Uses `cn()` from `@/lib/utils` for any conditional class composition (per AGENTS.md hard rule).

#### 3. Dashboard entry point

**File**: `src/components/Topbar.astro` OR `src/pages/dashboard.astro`

**Intent**: Add a "Review" link/button so the user can reach `/dashboard/review`. Pick whichever file already hosts dashboard navigation; if neither, add an inline button in `dashboard.astro` above the flashcard list.

**Contract**: Anchor `<a href="/dashboard/review">Review</a>` styled with existing `Button` component (`variant="default"` or matching the page's existing buttons).

### Success Criteria

#### Automated Verification

- `npm run build` succeeds.
- `npm run lint` passes.

#### Manual Verification

- Seed 3 due flashcards via `/dashboard`. Visit `/dashboard/review`. See card 1 front. Press Space → see back + 4 buttons each with an interval label (e.g., "Again · <1m", "Good · 10m"). Click Good → card 2 appears.
- Rate all 3 cards → empty state shows "All caught up!" + "Practice anyway" button.
- Click "Practice anyway" → review session restarts with same/different cards; rating buttons still appear but the underlying row's `due`/`state` do NOT change (verify in Supabase).
- Keyboard-only: Tab from page load reaches "Show answer", Space triggers it, then 1/2/3/4 grade.
- Visit `/dashboard/review` while logged out → redirected to `/auth/signin` (middleware).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests

- None added in MVP — existing repo has no test runner configured (per `package.json`); follow established convention. Add when a testing harness lands.

### Integration Tests

- Covered by Manual Verification per phase against the running dev stack + Supabase local.

### Manual Testing Steps

1. `npx supabase db reset` to apply the new migration.
2. Sign up / log in, create 3 flashcards via `/dashboard`.
3. Visit `/dashboard/review`, walk through each card with different ratings (Again, Good, Easy). Verify each row's `state`, `due`, `reps`, `last_review` update appropriately in Supabase.
4. Wait for queue to empty, click "Practice anyway", grade a card, verify Supabase row is unchanged.
5. Log out and try `/dashboard/review` and `GET /api/flashcards/review/queue` — both must block.
6. Keyboard-only walkthrough to confirm Space/1/2/3/4 work.

## Performance Considerations

- Queue fetch is bounded by user's due-card count (typically small) and indexed on `(user_id, due)`. No pagination needed for MVP.
- `previewRatings` runs 4 `scheduler.repeat` calls per queue item; negligible cost (pure JS, no IO).
- React island reuses the in-memory queue; no per-card refetch.

## Migration Notes

- Production `flashcards` table is empty (confirmed in [research.md §"Open Questions"](research.md)).
- Local dev: run `npx supabase db reset` — drops local data including any dev rows; acceptable for this slice.
- Any dev row that somehow survives (e.g., on another developer's machine) gets default FSRS state via column defaults — equivalent to "new card."

## References

- Library research: [context/changes/sr-review-session/library-research.md](library-research.md)
- API reference: [context/changes/sr-review-session/ts-fsrs-docs.md](ts-fsrs-docs.md)
- Compatibility research: [context/changes/sr-review-session/research.md](research.md)
- Similar service pattern: [src/lib/services/flashcard.service.ts](../../../src/lib/services/flashcard.service.ts)
- Similar schema pattern: [src/lib/schemas/flashcard.schemas.ts](../../../src/lib/schemas/flashcard.schemas.ts)
- Auth middleware: [src/middleware.ts](../../../src/middleware.ts)
- F-01 migration (predecessor): [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql)
- Roadmap S-02: [context/foundation/roadmap.md](../../foundation/roadmap.md)
- PRD FR-011/012/013: [context/foundation/prd.md](../../foundation/prd.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration & types

#### Automated

- [x] 1.1 `npx supabase db reset` applies cleanly with no errors — 3864771
- [x] 1.2 `npm run build` succeeds — 3864771
- [x] 1.3 `npm run lint` passes — 3864771

#### Manual

- [x] 1.4 Information_schema confirms FSRS columns present and SM-2 columns absent — 3864771
- [x] 1.5 `idx_flashcards_user_due` exists in `pg_indexes` — 3864771
- [x] 1.6 Manual CRUD on `/dashboard` still works end-to-end — 3864771

### Phase 2: Review service & scheduler

#### Automated

- [x] 2.1 `npm run build` succeeds
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm ls ts-fsrs` shows the package installed

#### Manual

- [x] 2.4 Rehydrate → scheduler.next → serialize round-trips a sample row cleanly

### Phase 3: API routes

#### Automated

- [ ] 3.1 `npm run build` succeeds
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 `GET /api/flashcards/review/queue` returns due cards with `preview` field when authed; 401 when not
- [ ] 3.4 `POST /api/flashcards/<id>/review` with `{rating:3}` mutates the row
- [ ] 3.5 `POST` with `{rating:3, practice:true}` returns `skipped:true` and leaves the row unchanged
- [ ] 3.6 `POST` with invalid rating returns Zod validation error

### Phase 4: Review page & React island

#### Automated

- [ ] 4.1 `npm run build` succeeds
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 Full review walkthrough across 3 seeded cards with different ratings updates Supabase correctly
- [ ] 4.4 Empty state shows "All caught up!" + "Practice anyway" button
- [ ] 4.5 Practice mode does NOT mutate row state in Supabase
- [ ] 4.6 Keyboard shortcuts (Space, 1/2/3/4) work
- [ ] 4.7 Logged-out access to `/dashboard/review` redirects to `/auth/signin`
