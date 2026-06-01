# Spaced Repetition Review Session — Plan Brief

> Full plan: `context/changes/sr-review-session/plan.md`
> Research: `context/changes/sr-review-session/research.md`

## What & Why

Ship the north-star slice (S-02): a logged-in user can start a spaced-repetition review session, walk cards one at a time, rate recall, and have the next review scheduled automatically. PRD's primary trust promise — "the right card at the right time" — depends on this loop working end-to-end.

## Starting Point

F-01 has landed a `flashcards` table with **SM-2** columns (`interval`, `ease_factor`, `repetitions`, `next_review_at`) and full RLS. S-01 ships manual CRUD that never reads SR columns. The table is empty in production. No SR library is installed; no review UI exists.

## Desired End State

User clicks "Review" from `/dashboard`, lands on `/dashboard/review`, sees the front of each due card, reveals the back, rates Again/Hard/Good/Easy (each labelled with its scheduled-next interval), and the FSRS scheduler persists updated memory state. When the queue empties, the user can opt into a "Practice anyway" session that does not mutate scheduling.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| SR library | `ts-fsrs` | Modern FSRS scheduling, zero-dep, edge-safe; PRD's "trust the when" benefits from better-calibrated algorithm than SM-2. | Research |
| Schema migration | New forward-only migration that drops SM-2 cols, adds FSRS cols, renames `next_review_at`→`due` | Production table empty; respects Supabase migration immutability. | Plan |
| FSRS parameters | Hardcoded `request_retention=0.9`, `enable_fuzz=true`, `enable_short_term=true` | No per-user settings in MVP; tunable later without breaking schema. | Plan |
| `review_logs` table | Skip for now | Non-breaking to add later; not required for the rating loop. | Research + Plan |
| Rating granularity | 4 levels (Again/Hard/Good/Easy) | `ts-fsrs` mandates 4; closes roadmap S-02 open question. | Research |
| Empty-queue UX | "All caught up!" + "Practice anyway" button (non-mutating) | Honors PRD FR-011 Socrates resolution; user is never blocked. | Plan |
| Rating-button preview | Show next interval next to each rating label | Makes the SR promise visible — directly supports PRD north star. | Plan |

## Scope

**In scope:**
- New Supabase migration replacing SM-2 columns with FSRS columns and rebuilding the per-user index.
- `Flashcard` type update.
- `ts-fsrs` install + new `review.service.ts` (singleton scheduler, `listDueCards`, `listPracticeCards`, `previewRatings`, `gradeCard`).
- `GET /api/flashcards/review/queue?mode=due|practice` and `POST /api/flashcards/[id]/review`.
- `/dashboard/review` page + `ReviewSession.tsx` React island with reveal-back, 4 rating buttons, keyboard shortcuts, empty state.
- Dashboard "Review" entry link.

**Out of scope:**
- `review_logs` table, `user_settings` table, per-user FSRS parameters.
- Deck/tag filtering, analytics, streaks.
- Editing F-01's migration in place.
- Unit/integration test harness (none in repo today).

## Architecture / Approach

Migration first → types → service → API → UI, mirroring F-01/S-01. The `ts-fsrs` scheduler is a module-level singleton in `review.service.ts`; `rehydrate`/`serialize` map between `Flashcard` rows and `ts-fsrs` `Card`. RLS handles read-side auth; writes use `.eq("user_id", userId)` defense-in-depth. The React island owns its queue locally — no per-card refetch.

```
ReviewSession.tsx ──GET── /api/flashcards/review/queue ──> listDueCards/listPracticeCards
       │                                                          │
       └──POST── /api/flashcards/[id]/review ──> gradeCard ──> ts-fsrs.scheduler.next ──> Supabase update
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration & types | New migration applied; `Flashcard` type matches FSRS columns | Index-rebuild ordering; verified by `db reset` running cleanly |
| 2. Review service & scheduler | `ts-fsrs` installed; `review.service.ts` with rehydrate/serialize/grade | Date round-trip bugs — caught by round-trip manual check |
| 3. API routes | Queue GET + grade POST live and auth-gated | Practice-mode mutation guard must be server-side (enforced in POST handler) |
| 4. Review page & React island | `/dashboard/review` with reveal-back, 4 rating buttons + interval previews, empty-state with "Practice anyway", keyboard shortcuts | UX clarity of rating intervals; verified by manual walkthrough |

**Prerequisites:** F-01 (landed), S-01 (impl_reviewed), Supabase local running, Node 22.14.0.
**Estimated effort:** ~1-2 sessions across the 4 phases.

## Open Risks & Assumptions

- Local dev databases will be reset (`npx supabase db reset`); any dev-only rows are discarded.
- No automated tests are added — repo has no test runner; manual verification per phase is the gate.
- `Intl.RelativeTimeFormat` is assumed available on Cloudflare Workers' V8 runtime (standard Web API, true today).

## Success Criteria (Summary)

- A user with due cards can complete a full review session end-to-end with each rating updating Supabase correctly.
- Empty queue offers "Practice anyway" mode that walks cards without mutating their schedule.
- Logged-out users cannot reach `/dashboard/review` or the review API endpoints.
