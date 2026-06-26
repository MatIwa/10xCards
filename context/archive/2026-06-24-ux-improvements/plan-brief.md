# UX improvements (S-05) — Plan Brief

> Full plan: `context/changes/ux-improvements/plan.md`

## What & Why

S-05 ships three UX polish items surfaced during S-01–S-03: selection-based bulk actions on the AI candidate review screen, a UI-only review session reset, and consistent loading states across the dashboard. The motivation is to remove the friction the roadmap identified once the core review loop and AI generation were in users' hands — clicking accept 15 times after a generation, losing a misclicked review session, and inconsistent "Loading…" affordances were the three concrete complaints that warranted a dedicated slice.

## Starting Point

The candidate review screen ([GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx)) has only per-card accept/reject; the review session ([ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx)) persists ratings immediately via FSRS with no abort path; loading states are a mix of `LoaderCircle` spinners and plain `<p>Loading…</p>` text across four sites. No shadcn `Skeleton` or `AlertDialog` is installed yet.

## Desired End State

Candidate review opens with every proposal pre-checked and exposes a header toolbar with "Select all/none", "Accept selected", and "Reject selected" buttons; bulk accept runs sequentially with a progress label and ends in an inline summary that reports accepted/rejected/skipped/failed counts. The review session header carries a "Reset" button that opens a confirm dialog and, on confirm, reloads the queue while keeping FSRS state on already-graded cards intact. The four ad-hoc loading-text sites use shape-matched shadcn `Skeleton` blocks; in-button `LoaderCircle` spinners stay where they belong.

## Key Decisions Made

| Decision                          | Choice                                                                                  | Why                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Bulk granularity                  | Selection-based (checkbox per card) + "Select all/none" + bulk-on-selected              | Covers both "accept everything" (default = all selected → one click) and "pick a few" with one mental model    |
| Default selection                 | All proposals selected by default                                                       | PRD targets 75% acceptance — the happy path is "accept most"; pre-selection minimizes clicks                   |
| Bulk validation                   | Skip invalid cards, accept the rest, show inline summary                                | One-click semantics survive bad cards; user reads the summary to see what was skipped                          |
| Bulk concurrency                  | Sequential `for...of await` over existing `acceptProposal`                              | Preserves the `flushSync` invariant that single-accept relies on; no rate-limit risk                           |
| Reset semantics                   | UI-only — reload queue, keep already-persisted FSRS state                               | Per-card commit is already the architecture; rollback would need a snapshot table + undo endpoint (out of MVP) |
| Reset trigger                     | Header "Reset" button + shadcn `AlertDialog` confirm                                    | Discoverable, deliberate; dialog focus trap prevents `1`–`4` keys from grading a card behind the modal         |
| Loading approach                  | shadcn `Skeleton` for initial loads; keep `LoaderCircle` for in-button action-pending   | Different jobs: skeletons = layout placeholder, spinners = action feedback                                     |
| Feedback channel                  | Inline emerald/red status blocks (no toast library)                                     | Consistent with existing UI; no new dependency; works without hydration races                                  |
| Scope discipline                  | Lock to the three items; any new UX issue → new change                                  | Mitigates the roadmap-flagged scope-drift risk for S-05                                                        |

## Scope

**In scope:**
- Selection state + checkbox + "Select all/none" + "Accept selected" / "Reject selected" in `GenerateFlashcards`
- Sequential bulk-accept with progress label + skip-invalid summary
- "Reset session" button + `AlertDialog` confirm + queue reload in `ReviewSession`
- shadcn `Skeleton` primitive + replacement of 4 ad-hoc loading-text sites
- shadcn `AlertDialog` primitive

**Out of scope:**
- FSRS rollback / undo endpoint or schema changes
- New bulk API endpoint (`POST /api/flashcards/bulk`)
- Toast library (no `sonner`)
- Keyboard shortcuts for bulk actions or reset
- Empty-state redesigns, dashboard layout changes, or any other UX polish

## Architecture / Approach

Three independent local-component changes with two new shadcn primitives (`Skeleton`, `AlertDialog`). No API contract changes, no schema changes, no new services. Bulk-accept reuses the existing `acceptProposal` per-card flow inside a sequential loop, preserving the `flushSync` ordering invariant that protects concurrent state updates. Reset reuses the existing `loadQueue(mode)` call site and relies on the per-card-commit FSRS architecture to "just work" without rollback logic.

## Phases at a Glance

| Phase                              | What it delivers                                                                                                                              | Key risk                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Loading-state primitives        | shadcn `Skeleton` installed; 4 ad-hoc `Loading…` text sites replaced with shape-matched skeletons                                             | Skeleton shapes drift from real layout — manual visual check required                               |
| 2. Bulk candidate actions          | Selection state, checkbox per card, header toolbar, sequential bulk accept/reject with progress + summary                                     | `selectedIds` getting out of sync with `proposals` after per-card or bulk mutations                 |
| 3. Review session reset            | shadcn `AlertDialog` installed; header Reset button; confirm-then-reload-queue; keyboard isolation                                            | `Space` / `1`–`4` global listener leaking through the dialog and grading a card behind the modal    |

**Prerequisites:** F-01 (flashcard schema with SR — done), S-01 (manual CRUD — done), S-02 (SR review — done), S-03 (AI generation — done). All blockers cleared.

**Estimated effort:** ~1 session per phase (3 sessions total). Phases are independently shippable.

## Open Risks & Assumptions

- **Skeleton shape drift**: if `FlashcardList` or `ReviewSession` layouts change after Phase 1 lands, the skeletons may stop matching the real content shape. Mitigation: skeleton rectangles are intentionally generic (rounded rectangles, not pixel-perfect mocks).
- **Native `<input type="checkbox">` styling**: the plan defaults to a native checkbox to avoid pulling in another shadcn primitive. If the styled native version looks out-of-place at impl-review, fall back to `npx shadcn@latest add checkbox` — small follow-up.
- **AlertDialog focus trap**: assumes Radix's default focus management is sufficient to block the global `keydown` listener on the review screen. Phase 3 includes an explicit manual check and a gate-the-listener fallback if a leak is observed.
- **Bulk-accept latency**: 15 sequential accepts at ~200ms each ≈ 3s wall time. The progress indicator makes this tolerable; if AI ever returns >25 proposals (it currently doesn't), revisit.

## Success Criteria (Summary)

- A user can accept or reject most/all AI proposals with at most two clicks (one selection adjustment + one bulk button).
- A user can reset a partially-finished review session without losing already-graded cards' progress.
- Every initial-load surface in the dashboard uses a shape-matched skeleton; no plain `Loading…` text remains in `src/components/`.
