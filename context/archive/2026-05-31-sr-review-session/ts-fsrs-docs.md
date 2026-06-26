# ts-fsrs Reference for S-02 (sr-review-session)

Fetched 2026-06-01 via Context7 MCP (`/open-spaced-repetition/ts-fsrs`).
Source: https://github.com/open-spaced-repetition/ts-fsrs (README + packages/fsrs/README.md)

> Scope: only what S-02 needs — scheduler init, Card lifecycle, rating a review, persisting state.
> The current roadmap `flashcard-schema-with-sr` (F-01) assumes SM-2 columns (`interval`, `ease_factor`, `repetitions`). FSRS uses a **different memory-state model** — see "Schema impact" below before locking F-01.

## 1. Core API

### Scheduler

```typescript
import { fsrs, generatorParameters, type FSRSParameters } from 'ts-fsrs'

const scheduler = fsrs({
  request_retention: 0.9,      // target recall probability (0–1)
  maximum_interval: 36500,     // cap (days)
  enable_fuzz: true,           // randomize intervals slightly to avoid clumping
  enable_short_term: true,     // use learning/relearning steps
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
})

// Persist params if you want them per-user:
const params = generatorParameters({ request_retention: 0.9, maximum_interval: 36500 })
JSON.stringify(params)   // safe to store
// later:
const reloaded = JSON.parse(serialized) as FSRSParameters
const s = fsrs(reloaded)
```

### Card lifecycle

```typescript
import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs'

const card = createEmptyCard()   // brand-new card, State.New, due = now
```

`State` enum:
- `State.New`
- `State.Learning`
- `State.Relearning`
- `State.Review`

`Rating` enum (what the user clicks during review):
- `Rating.Again`
- `Rating.Hard`
- `Rating.Good`
- `Rating.Easy`

### Preview vs commit

```typescript
// Preview all four outcomes BEFORE the user answers
// (useful to show "next review in X" on each rating button)
const preview = scheduler.repeat(card, new Date())
preview[Rating.Good].card.due       // Date
preview[Rating.Again].card.due

// Commit the chosen rating AFTER the user answers
const result = scheduler.next(card, new Date(), Rating.Good)
result.card    // updated Card to persist
result.log     // RecordLogItem (review history entry)
```

### Serialize for DB (afterHandler)

```typescript
const saved = scheduler.next(card, new Date(), Rating.Good, ({ card, log }) => ({
  card: {
    ...card,
    due: card.due.getTime(),                          // ms epoch
    last_review: card.last_review?.getTime() ?? null,
  },
  log: {
    ...log,
    due: log.due.getTime(),
    review: log.review.getTime(),
  },
}))
```

For Supabase / Postgres, prefer ISO strings (`timestamptz`) instead of epoch ms — same pattern, swap `.getTime()` for `.toISOString()`.

## 2. Card data model (what F-01 must persist)

A `Card` produced by `createEmptyCard()` / `scheduler.next(...).card` has these fields (FSRS memory state, NOT SM-2):

| Field | Type | Purpose |
|---|---|---|
| `due` | `Date` | Next review timestamp |
| `stability` | `number` | FSRS memory stability |
| `difficulty` | `number` | FSRS difficulty (1–10) |
| `elapsed_days` | `number` | Days since previous review at the time of last review |
| `scheduled_days` | `number` | Interval (days) chosen at last review |
| `learning_steps` | `number` | Index into learning/relearning steps |
| `reps` | `number` | Total reviews |
| `lapses` | `number` | Times rated `Again` from Review state |
| `state` | `State` | New / Learning / Review / Relearning |
| `last_review` | `Date \| undefined` | Timestamp of last review (undefined for new) |

`ReviewLog` / `RecordLogItem` (returned alongside `card`) carries the review event: rating, state before review, `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `review` (timestamp). Persist these to a `review_logs` table if we want optimizer/history support later.

## 3. Reading due cards

ts-fsrs does **not** ship a query helper. The "deck for today" comes from Supabase:

```sql
select * from flashcards
where user_id = auth.uid()
  and due <= now()
order by due asc;
```

(Cards in `State.New` have `due` set to creation time, so they surface naturally.)

## 4. Schema impact on F-01

F-01 currently plans SM-2 columns. To use `ts-fsrs` we need to replace them with FSRS columns:

```sql
-- columns to add on flashcards (in place of interval / ease_factor / repetitions)
due              timestamptz  not null default now(),
stability        double precision not null default 0,
difficulty       double precision not null default 0,
elapsed_days     integer      not null default 0,
scheduled_days   integer      not null default 0,
learning_steps   integer      not null default 0,
reps             integer      not null default 0,
lapses           integer      not null default 0,
state            smallint     not null default 0,    -- mirrors State enum (0..3)
last_review      timestamptz
```

Plus an optional `review_logs` child table keyed by `flashcard_id` for full FSRS history.

> Decision needed before `/10x-plan sr-review-session`: confirm switch from SM-2 → FSRS columns in F-01, or pick `supermemo` (per existing library-research.md). Library-research.md currently lists `ts-fsrs` as the "alternative if we adjust schema" — this doc is that adjustment.

## 5. Minimal end-to-end flow for S-02

```typescript
// src/lib/services/review.service.ts (sketch)
import { fsrs, Rating, State, type Card } from 'ts-fsrs'

const scheduler = fsrs({ enable_fuzz: true, enable_short_term: true })

export function rehydrate(row: FlashcardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  }
}

export function gradeCard(row: FlashcardRow, rating: Rating, now = new Date()) {
  const card = rehydrate(row)
  const { card: next, log } = scheduler.next(card, now, rating)
  return {
    update: {
      due: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      learning_steps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      last_review: next.last_review?.toISOString() ?? null,
    },
    log,
  }
}
```

## 6. Recall-rating granularity (closes roadmap open question for S-02)

`ts-fsrs` requires the **4-level** Rating (Again / Hard / Good / Easy). No binary or 3-level mode. UI must surface all four buttons.
