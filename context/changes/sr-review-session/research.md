---
date: 2026-06-01T00:00:00Z
researcher: GitHub Copilot
git_commit: 1ab6bdbb459c02f947c52f238ba9e6b57351b98a
branch: master
repository: MatIwa/10xCards
topic: "Is `ts-fsrs` compatible with the 10xCards codebase for implementing S-02 (sr-review-session)?"
tags: [research, codebase, sr-review-session, ts-fsrs, scheduling, schema]
status: complete
last_updated: 2026-06-01
last_updated_by: GitHub Copilot
---

# Research: Is `ts-fsrs` compatible with our codebase for S-02?

**Date**: 2026-06-01
**Researcher**: GitHub Copilot
**Git Commit**: `1ab6bdbb459c02f947c52f238ba9e6b57351b98a`
**Branch**: `master`
**Repository**: `MatIwa/10xCards`

## Research Question

Review the codebase and decide whether [`ts-fsrs-docs.md`](ts-fsrs-docs.md) (the `ts-fsrs` library) is compatible with it, in the context of implementing roadmap slice **S-02 (sr-review-session)** from [roadmap.md](../../foundation/roadmap.md).

## Summary

**Verdict: Runtime-compatible. Schema-incompatible as currently shipped.**

- `ts-fsrs` is a pure-TypeScript, zero-dependency MIT library and will run unchanged on the Cloudflare Workers edge runtime that hosts this Astro 6 SSR app. There are no platform, bundler, or dependency blockers.
- **However**, the `flashcards` table that F-01 already shipped to `master` ([supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql)) encodes **SM-2** memory state (`interval`, `ease_factor`, `repetitions`, `next_review_at`). `ts-fsrs` needs the **FSRS** memory model (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `due`, `last_review`) — a different set of columns with no clean 1:1 mapping.
- Adopting `ts-fsrs` therefore requires a **new migration** that extends or replaces the SM-2 columns. The change is small (single additive migration, default values for existing rows) and **not blocked by S-01 (`manual-flashcard-crud`)** which is already `impl_reviewed` — manual CRUD only writes `front`/`back`/`source`/`user_id` and never touches the SR columns ([flashcard.service.ts:25–46](../../../src/lib/services/flashcard.service.ts)).
- The realistic decision is: **(a) ship a schema-update migration and use `ts-fsrs`**, or **(b) use `supermemo` / `@open-spaced-repetition/sm-2`** which fits the existing schema as-is (this matches the default in [library-research.md](library-research.md)).
- Recommendation: **option (a) — adopt `ts-fsrs` and migrate the schema**. Reasons below.

## Detailed Findings

### 1. Runtime / stack compatibility — ✅ no blockers

- **TypeScript / ESM**: project is `"type": "module"` ([package.json:3](../../../package.json)) with TS 5.9; `ts-fsrs` ships ESM + types out of the box.
- **Cloudflare Workers (edge)**: deploy target is `@astrojs/cloudflare` ([package.json:14](../../../package.json), `wrangler.jsonc`). `ts-fsrs` is pure JS — no Node built-ins (`fs`, `crypto.randomBytes`, etc.), no native deps, zero runtime deps. It works on Workers without polyfills.
- **Bundle size**: `ts-fsrs` is small and tree-shakeable; no concern for a Worker bundle that already pulls Astro + Supabase.
- **Astro 6 SSR + React 19 islands**: scheduling will run inside the API route handler (server-side), which is the correct place; no React/Astro version interaction.
- **Lessons compliance**: [lessons.md](../../foundation/lessons.md) currently only forbids Lodash. `ts-fsrs` is neither Lodash nor a "convenience" dep — it implements a non-trivial algorithm we explicitly do NOT want to write ourselves (PRD non-goal "no custom SR algorithm", echoed in [roadmap.md](../../foundation/roadmap.md) §Parked). No lessons violated.

### 2. Database schema compatibility — ❌ as shipped

What F-01 wrote to `master` ([20260531120000_create_flashcards.sql:11–28](../../../supabase/migrations/20260531120000_create_flashcards.sql)):

| Column | Type | Purpose (SM-2) |
|---|---|---|
| `interval` | `integer` default `0` | days until next review |
| `ease_factor` | `real` default `2.5` | SM-2 ease |
| `repetitions` | `integer` default `0` | successful-rep counter |
| `next_review_at` | `timestamptz` default `now()` | due time |

What `ts-fsrs` `Card` needs ([ts-fsrs-docs.md §2](ts-fsrs-docs.md), [§4](ts-fsrs-docs.md)):

| Column | Type | Notes |
|---|---|---|
| `due` | `timestamptz` | == our `next_review_at` (renameable) |
| `stability` | `double precision` | FSRS state — **new** |
| `difficulty` | `double precision` | FSRS state — **new** |
| `elapsed_days` | `integer` | **new** |
| `scheduled_days` | `integer` | **new** (loosely overlaps `interval`) |
| `learning_steps` | `integer` | **new** |
| `reps` | `integer` | overlaps `repetitions` |
| `lapses` | `integer` | **new** |
| `state` | `smallint` (0..3) | **new** (New/Learning/Review/Relearning) |
| `last_review` | `timestamptz` nullable | **new** |

There is no clean 1:1 mapping: SM-2's `ease_factor` ≠ FSRS `difficulty`/`stability`, and FSRS needs state it can compute only from its own history. **Conclusion**: you can't run `ts-fsrs` against the F-01 schema unchanged. A new migration is mandatory.

### 3. Manual CRUD (S-01) does NOT block the schema change

S-01 is `impl_reviewed` ([change.md](../manual-flashcard-crud/change.md)) and only reads/writes the user-visible card fields:

- Service writes `user_id`, `front`, `back`, `source` on insert ([flashcard.service.ts:25–46](../../../src/lib/services/flashcard.service.ts)).
- Update touches only `{ front, back }` via the Zod `updateFlashcardSchema` ([flashcard.service.ts:48–72](../../../src/lib/services/flashcard.service.ts)).
- `Flashcard` TS type ([src/types.ts](../../../src/types.ts)) names the SM-2 columns but never indexes into them outside the service layer.

So renaming/replacing the SR columns affects **only** F-01's migration and `src/types.ts`, plus the new S-02 review service. No S-01 code path will break beyond updating the `Flashcard` interface (a single file).

### 4. Auth + RLS — fits the FSRS query pattern cleanly

The "fetch cards due today" query proposed in [ts-fsrs-docs.md §3](ts-fsrs-docs.md):

```sql
select * from flashcards
where user_id = auth.uid()
  and due <= now()
order by due asc;
```

is exactly what F-01 already optimizes for: the composite index `idx_flashcards_user_next_review (user_id, next_review_at)` ([migration:32–34](../../../supabase/migrations/20260531120000_create_flashcards.sql)) covers it (just renamed). RLS policies (`flashcards_select_own`, `_update_own`, etc.) already enforce per-user isolation — `ts-fsrs` is stateless and operates in app code, so all auth/ownership concerns remain handled by Supabase as they are today. ✅

The middleware already protects `/api/flashcards` and returns JSON `401` instead of redirecting ([middleware.ts:5–28](../../../src/middleware.ts)) — a new `/api/flashcards/.../review` route will inherit this with no changes.

### 5. Recall-rating granularity — closes a roadmap open question

Roadmap S-02 §Unknowns asks "binary / 3-level / 5-level?". `ts-fsrs` mandates exactly **4 levels**: `Again | Hard | Good | Easy` ([ts-fsrs-docs.md §6](ts-fsrs-docs.md)). If we pick `ts-fsrs`, the UI **must** expose four buttons. (`supermemo` uses a 0–5 grade — also fine, just different UX.)

### 6. Persistence ergonomics

`ts-fsrs` returns `Date` objects; Supabase columns are `timestamptz`. The `afterHandler` pattern in [ts-fsrs-docs.md §1](ts-fsrs-docs.md) makes serialization trivial (`.toISOString()`). The optional `review_logs` child table is a nice-to-have for future FSRS optimizer/history, not required for MVP S-02.

## Code References

- [supabase/migrations/20260531120000_create_flashcards.sql:11–28](../../../supabase/migrations/20260531120000_create_flashcards.sql) — current SM-2 columns that must change
- [src/types.ts:1–15](../../../src/types.ts) — `Flashcard` interface mirrors SM-2 columns, must be updated alongside migration
- [src/lib/services/flashcard.service.ts:14–86](../../../src/lib/services/flashcard.service.ts) — manual CRUD service; never reads SR columns, safe to leave alone aside from type drift
- [src/middleware.ts:5–28](../../../src/middleware.ts) — `/api/flashcards/*` is already auth-gated with JSON 401; new review endpoint inherits this
- [package.json:14–37](../../../package.json) — confirms `@astrojs/cloudflare`, Astro 6, React 19, Supabase SSR, Zod present; no SR lib yet
- [context/changes/sr-review-session/ts-fsrs-docs.md](ts-fsrs-docs.md) — the library reference under evaluation
- [context/changes/sr-review-session/library-research.md](library-research.md) — prior shortlist (default = `supermemo`, alternative = `ts-fsrs`)

## Architecture Insights

- The codebase intentionally treats the database as the single source of truth (F-01 plan §"Migration first, types after"). Any SR library choice **must** be reflected in a migration before app code lands — adopting `ts-fsrs` is therefore a coordinated F-01-amendment + S-02 implementation, not a pure S-02 task.
- The service-layer convention (`src/lib/services/*.service.ts`, accepts a `SupabaseClient`, returns `{ data, error }`) — established by `flashcard.service.ts` — is the natural home for an FSRS scheduler wrapper: a `review.service.ts` exporting `listDueCards(supabase)` and `gradeCard(supabase, id, rating)` mirrors the existing shape.
- RLS-based authorization means the review service does NOT need to pass `user_id` explicitly on reads (Supabase derives it from the session); writes already use `.eq("user_id", userId)` as defense in depth ([flashcard.service.ts:58, 76](../../../src/lib/services/flashcard.service.ts)).

## Historical Context (from prior changes)

- [context/changes/flashcard-schema-with-sr/plan.md](../flashcard-schema-with-sr/plan.md) — F-01 plan committed to SM-2 columns and acknowledged: "SR metadata columns must accommodate the chosen SR library; designing for SM-2 family covers the most common open-source options and minimizes rework." That guarantee held only as long as we picked an SM-2 library; pivoting to `ts-fsrs` is the rework F-01 explicitly accepted as possible.
- [context/changes/sr-review-session/library-research.md](library-research.md) — preliminary shortlist defaulted to `supermemo` (best schema fit) and listed `ts-fsrs` as "alternative if we adjust schema". This research closes the loop by confirming the schema adjustment is small and isolated.
- [context/changes/manual-flashcard-crud/plan.md](../manual-flashcard-crud/plan.md) §"Key Discoveries" — confirms RLS handles per-user isolation in the service layer; that property carries over to the review service.

## Related Research

- [context/changes/sr-review-session/library-research.md](library-research.md) — full library shortlist with NPM signals
- [context/changes/sr-review-session/ts-fsrs-docs.md](ts-fsrs-docs.md) — `ts-fsrs` API reference and proposed schema delta

## Recommendation

**Adopt `ts-fsrs` and ship a schema-update migration.**

Rationale:
1. **Compatibility risk is low**: one additive migration + one type-file edit. S-01 code is unaffected because manual CRUD never reads SR columns.
2. **Algorithmic quality**: FSRS is the modern, better-calibrated successor to SM-2; PRD's north star ("trust the when-to-review promise") benefits directly from this. Choosing `supermemo` saves a migration but locks us into 1980s-era scheduling.
3. **Maintenance**: `ts-fsrs` is actively maintained, zero-dep, MIT, edge-safe.
4. **Future-proofing**: FSRS supports per-user parameter optimization via `review_logs`; SM-2 has no equivalent path.

Concrete next steps (for `/10x-plan sr-review-session`):
1. **Schema migration** `supabase/migrations/<ts>_flashcards_fsrs.sql` — drop `interval`, `ease_factor`, `repetitions`; add the FSRS columns from [ts-fsrs-docs.md §4](ts-fsrs-docs.md); rename `next_review_at` → `due` (or keep the name and adapt the rehydrate function); recreate the composite index on `(user_id, due)`. Existing rows get defaults (`state=0`, `stability=0`, `difficulty=0`, `due=now()`) which makes them behave as new cards under FSRS.
2. **Type update** `src/types.ts` — replace SM-2 fields with FSRS fields.
3. **Install** `npm install ts-fsrs`.
4. **Service** `src/lib/services/review.service.ts` — `listDueCards`, `gradeCard(id, rating)` using the sketch in [ts-fsrs-docs.md §5](ts-fsrs-docs.md).
5. **API** `src/pages/api/flashcards/[id]/review.ts` (POST) — validates rating with Zod (enum of 1..4), calls `gradeCard`, writes back via Supabase. List endpoint can reuse `GET /api/flashcards?due=true`.
6. **UI** dashboard "Review" entry point + a `ReviewSession.tsx` React island with reveal-back + 4 rating buttons.

## Open Questions

- **Per-user FSRS parameters**: store on a `user_settings` table or hard-code `request_retention=0.9` for MVP? (Default to hard-code; open later if needed.)
- **`review_logs` table**: ship now or later? (Recommend later — not required for the rating loop; adding it post-launch is non-breaking.)
- **Migration of existing dev rows**: resetting with `npx supabase db reset` is the simplest path since the table is empty in production. Confirm before applying.
