# UX improvements (S-05) Implementation Plan

## Overview

Ship three independent UX polish items surfaced during S-01–S-03: selection-based bulk actions on the AI candidate review screen (default-all-selected, sequential execution with progress, skip-invalid summary), a UI-only review session reset (reload queue, keep already-persisted FSRS ratings, behind a confirm dialog), and consistent loading states across the dashboard (shadcn `Skeleton` for initial loads, `LoaderCircle` for in-button actions). Targets PRD FR-006 (per-card review extended with bulk), FR-011, FR-012 (review session reset).

## Current State Analysis

- **AI candidate review** ([src/components/dashboard/GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx)) has only per-card accept/reject buttons. `acceptProposal()` POSTs to `/api/flashcards` one card at a time, using `flushSync` to keep concurrent resolutions safe. No selection state exists today.
- **Review session** ([src/components/dashboard/ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx)) persists each rating immediately via `POST /api/flashcards/{id}/review`, which calls `fsrs.next(...)` in [src/lib/services/review.service.ts](../../../src/lib/services/review.service.ts) (in `scheduleNext`) and UPDATEs Supabase. There is no reset/abort path; only a "Retry" button on error state and a "Practice anyway" path from `empty`.
- **Loading states are inconsistent**: ad-hoc text in `GenerateFlashcards.tsx` (the `state === "generating"` banner in `renderPasteView`), `ReviewSession.tsx` ("Loading review queue…" in `renderShell`), `FlashcardList.tsx` ("Loading flashcards…"), and `FlashcardForm.tsx` ("Saving…" button label). `LoaderCircle` from `lucide-react` is used for in-button spinners. No shadcn `Skeleton` is installed; [src/components/ui/](../../../src/components/ui/) contains only `button, card, input, label, LibBadge, textarea`. No `AlertDialog`.
- **Conventions**: `cn()` from `@/lib/utils`, shadcn "new-york" style, Zod schemas in [src/lib/schemas/](../../../src/lib/schemas/), feedback via inline emerald/red blocks (no toast lib installed).

## Desired End State

- The candidate review screen renders a checkbox per proposal (all checked by default) plus a header toolbar with "Select all" / "Select none" toggles and "Accept selected" / "Reject selected" buttons. Per-card accept/reject buttons stay as escape hatch. Clicking a bulk button runs the action sequentially with a visible progress indicator ("Accepting 3/12…") and ends in an inline summary block ("Accepted 8, skipped 2 — fix errors and retry"); invalid proposals are skipped, never crashing the batch.
- The review session header carries a small "Reset session" button (visible during `reviewing` and `revealed` states only — excluded during `submitting` to avoid racing in-flight POSTs). Clicking opens a shadcn `AlertDialog` ("Reload the queue? Ratings already submitted will be kept."). Confirm re-calls `loadQueue(currentMode)` to fetch a fresh queue; cancel closes the dialog. Already-persisted FSRS state on graded cards stays untouched.
- The four ad-hoc `Loading…` text sites use shape-matching shadcn `Skeleton` blocks. In-button states keep `LoaderCircle`. The dashboard, flashcard list, and review queue all share the skeleton primitive.

### Key Discoveries:

- Accept POSTs are inherently sequential today because of the `flushSync` invariant inside `acceptProposal` in [GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx); bulk-accept must preserve that ordering.
- FSRS state is persisted per rating immediately (`scheduleNext` in [review.service.ts](../../../src/lib/services/review.service.ts)), so the only sensible reset semantics for an MVP is "reload the queue UI"; rollback would require a snapshot table and a new undo endpoint, which is out of scope.
- `getSourceForProposal` already differentiates `ai_full` vs `ai_edited` based on whether the front/back changed — bulk accept must call it per proposal to preserve source-attribution accuracy.
- Existing `validateProposal` returns `{ front?, back? }` errors — bulk-accept's "skip invalid" logic reuses this with no schema change.
- Keyboard shortcuts already exist for review (`Space` reveals, `1-4` rates — see `handleKeyDown` in [ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx)); the reset button must not collide and the confirm dialog must trap focus so digit keys don't grade a card behind the modal.
- shadcn components are added via `npx shadcn@latest add <name>` per [AGENTS.md](../../../AGENTS.md); both `skeleton` and `alert-dialog` are available in the "new-york" style.

## What We're NOT Doing

- **No FSRS rollback / undo endpoint.** Reset is UI-only; ratings already submitted stay persisted. A future change can add `POST /api/flashcards/{id}/review/undo` if needed.
- **No new bulk API endpoint.** Bulk accept loops the existing `POST /api/flashcards` per card.
- **No toast library** (no `sonner`). Summaries and confirmations use the existing inline emerald/red blocks pattern.
- **No keyboard shortcuts** for bulk actions or reset.
- **No empty-state redesigns, dashboard layout changes, or unrelated UX polish.** Per the roadmap risk note for S-05, any other UX issues discovered during implementation route to a new change, not into this plan.
- **No changes to the generation or review API contracts**, the FSRS scheduler, or the flashcards table schema.

## Implementation Approach

Three phases, each independently shippable and independently reviewable, ordered to land the smallest primitive first:

1. **Skeletons first.** Install shadcn `Skeleton`, swap the four ad-hoc `<p>Loading…</p>` sites for shape-matched skeletons. Tiny scope, no logic changes, sets up a reusable primitive Phase 2 and Phase 3 will reuse for any new loading needs.
2. **Bulk candidate actions.** Add `Set<string>` selection state to `GenerateFlashcards`, render a checkbox per proposal with `useId`-stable IDs, add a header toolbar component with "Select all/none" + "Accept selected" / "Reject selected" buttons. Implement `acceptSelected()` and `rejectSelected()` as sequential loops over the existing per-card `acceptProposal` / `rejectProposal` logic, gated by a `bulkAction` state slice that drives a progress label and disables per-card buttons during the batch. End every bulk run with a summary block in the review header.
3. **Review session reset.** Install shadcn `AlertDialog`, add a "Reset session" button to the review screen header (visible only when state is `reviewing` / `revealed`), wire it to an alert dialog that re-calls `loadQueue(practiceMode ? "practice" : "due")` on confirm.

## Critical Implementation Details

- **Bulk-accept concurrency invariant.** `acceptProposal` currently uses `flushSync` to guarantee no two concurrent accepts read a stale `proposals` array. Bulk-accept MUST run sequentially (await each call) — issuing them in parallel breaks this invariant and is explicitly rejected in the decision table. Use a simple `for...of` loop over the selected IDs, awaiting `acceptProposal(id)` each iteration; this naturally serializes through the existing code path.
- **Focus management on reset dialog.** The review screen has a global `keydown` listener (in `ReviewSession.tsx`) for `Space` (reveal) and `1-4` (grade), attached to `window`. Radix's `AlertDialog` focus trap moves focus into the dialog but does NOT block window-level listeners, and the existing `isTyping` early-return (INPUT/TEXTAREA/contentEditable only) doesn't catch a focused dialog `<button>`. The gate must therefore be preemptive: track `resetDialogOpen` state synced to `onOpenChange`, and `if (resetDialogOpen) return;` at the very top of `handleKeyDown`. Do not rely on testing-then-gating-if-leaked.
- **Source attribution during bulk accept.** Call `getSourceForProposal(proposal)` per card inside the loop — do not hoist a single source value. A user may have edited some selected cards (`ai_edited`) and left others (`ai_full`).

## Phase 1: Loading-state primitives

### Overview

Install the shadcn `Skeleton` component and replace the four ad-hoc `<p>Loading…</p>` sites with shape-matched skeleton blocks. Leave existing `LoaderCircle` in-button spinners alone — they serve a different purpose (action-pending feedback vs initial layout-load placeholder).

### Changes Required:

#### 1. Install shadcn Skeleton primitive

**File**: `src/components/ui/skeleton.tsx` (new — generated by shadcn CLI)

**Intent**: Add the shadcn `Skeleton` primitive to the project so subsequent components can compose loading placeholders that match content shape.

**Contract**: Run `npx shadcn@latest add skeleton`. The generated file exports a default `Skeleton` React component accepting standard `div` props plus a `className` merged via `cn()`. No manual edits needed; the file appears in [src/components/ui/](../../../src/components/ui/) alongside `button.tsx`.

#### 2. Replace loading text in flashcard list

**File**: `src/components/dashboard/FlashcardList.tsx`

**Intent**: When `isLoading` is true, render a list-shaped skeleton (3–4 rectangular blocks roughly matching the rendered `<li>` rows) instead of the plain "Loading flashcards…" text.

**Contract**: In the `isLoading` branch of [FlashcardList.tsx](../../../src/components/dashboard/FlashcardList.tsx), replace the `<p className="text-sm text-blue-100/80">Loading flashcards…</p>` block with a `<ul>` of 3 `<li>` items, each containing a `<Skeleton className="h-16 w-full rounded-lg" />`. Match the existing list spacing (`space-y-3`).

#### 3. Replace loading text in review queue load

**File**: `src/components/dashboard/ReviewSession.tsx`

**Intent**: When state is `loading` (initial queue fetch), render a card-shaped skeleton matching the answer/front box layout instead of "Loading review queue…".

**Contract**: In the `state === "loading"` branch of `renderShell` in [ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx), replace the loading text with two stacked `<Skeleton className="h-44 w-full rounded-lg" />` blocks (matching the front/back card geometry) plus a row of four `<Skeleton className="h-12 w-full rounded-md" />` (matching the rating button row).

#### 4. Generating-state skeleton in GenerateFlashcards

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: When `state === "generating"`, augment the existing inline spinner banner with a placeholder list (3 proposal-shaped skeletons) below it so users see the shape of what's coming. Keep the spinner-with-text banner for status clarity.

**Contract**: In the `state === "generating"` block in `renderPasteView` of [GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx), append below the spinner banner a `<ul>` of 3 `<Skeleton className="h-32 w-full rounded-lg" />` items. Do NOT touch the in-button `LoaderCircle` in the Generate submit button below it.

#### 5. Leave in-button spinners untouched

**Files**: `src/components/dashboard/FlashcardForm.tsx`, `src/components/dashboard/GenerateFlashcards.tsx` (per-card accept buttons inside `renderReviewView`)

**Intent**: Document explicitly that in-button "Saving…" / accept-spinner states are correct as-is — they're action-pending feedback, not layout-load placeholders. No code change.

**Contract**: No edit. Phase 1 success criteria below explicitly assert these spinners remain.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles cleanly: `npm run build`
- ESLint passes: `npm run lint`
- The file `src/components/ui/skeleton.tsx` exists and exports `Skeleton`.
- No occurrence of the literal strings `"Loading flashcards…"`, `"Loading flashcards..."`, `"Loading review queue…"`, or `"Loading review queue..."` remains under `src/components/` (verify with grep).

#### Manual Verification:

- Loading the dashboard's flashcard list shows shape-matching skeletons during the initial fetch, not plain text.
- Starting a review session shows two large skeleton blocks + four rating-button skeletons during the queue load, then transitions cleanly into the live review UI.
- Triggering AI generation shows the spinner banner AND 3 proposal-shaped skeletons during `generating`; both clear when proposals arrive.
- Per-card accept buttons in candidate review still show their `LoaderCircle` spinner during save (regression check).
- "Saving…" label on the flashcard form button still appears during submit (regression check).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Bulk candidate actions

### Overview

Add selection state to the AI candidate review screen plus a header toolbar that exposes "Select all" / "Select none", "Accept selected", and "Reject selected" buttons. Bulk accept runs sequentially over the selected proposals, skipping any that fail validation, and ends in a summary block. The selection model defaults to all proposals selected so the optimistic happy path is a single click.

### Changes Required:

#### 1. Add selection + bulk-action state

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: Extend the component's local state with a `Set<string>` of selected proposal IDs (initialized to all proposal IDs on each successful generation) and a `bulkAction` slice that drives the progress label and disables per-card buttons during a bulk run.

**Contract**: Add two `useState` slices: `selectedIds: Set<string>` and `bulkAction: { kind: "idle" } | { kind: "accepting" | "rejecting"; total: number; done: number }`. On successful generation (where proposals are set into state today, in `generateCards`), initialize `selectedIds` to `new Set(newProposals.map(p => p.id))`. When proposals are mutated by accept/reject (per-card or bulk), `selectedIds` must be cleaned to remove no-longer-present IDs.

The bulk-run summary is NOT a fourth `bulkAction` variant — it is routed through the existing `statusMessage` slice (the emerald banner already rendered in `renderPasteView`). This guarantees the summary remains visible after `finishIfLastProposal` drops the component back to the idle `renderPasteView`, which `renderReviewView` (and any state inside it) cannot.

#### 2. Render checkboxes and selection header toolbar

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: In `renderReviewView`, add a checkbox to each proposal `<li>` and a sticky header toolbar above the list with selection controls and bulk buttons. The toolbar shows the current selection count.

**Contract**: Inside `renderReviewView`:
- At the top of the `<div className="space-y-5">`, render a toolbar `<div>` with: a "Select all" / "Select none" toggle button (label flips based on whether `selectedIds.size === proposals.length`), a `<span>` showing "{selectedIds.size} of {proposals.length} selected", an "Accept selected" `<Button>`, and a "Reject selected" `<Button>`. Disable all four when `bulkAction.kind !== "idle"` or `selectedIds.size === 0`.
- Inside each proposal `<li>`, add a leading `<input type="checkbox">` (or shadcn `Checkbox` if installed — otherwise a styled native input is acceptable; do NOT add a new shadcn primitive unless the native option is rejected at impl-review). Bind `checked` to `selectedIds.has(proposal.id)`, `onChange` to toggle the ID in the set.
- The per-card "Accept" and "Reject" buttons at the bottom of each `<li>` stay unchanged.

#### 3. Implement acceptSelected and rejectSelected

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: Two new async handlers that loop sequentially over `selectedIds`, calling the existing single-proposal logic, tracking progress, and producing a summary state at the end.

**Contract**: First, refactor `acceptProposal` to return its outcome rather than `void`:

```ts
type AcceptOutcome = { status: "accepted" } | { status: "failed"; error: string };
async function acceptProposal(proposalId: string): Promise<AcceptOutcome> { ... }
```

The function still does its existing `flushSync` work; on the success path it returns `{ status: "accepted" }`, on the catch path (after `setSaveError`) it returns `{ status: "failed", error: message }`. Update the per-card button call site to ignore the return value (`void acceptProposal(id)`). This keeps the `flushSync` invariant intact (sequential awaits in the bulk loop) and gives the loop a direct signal — no need to inspect post-state closures, which the bulk loop's stale `proposals` snapshot cannot do reliably.

Then add `acceptSelected()` and `rejectSelected()`:
- `acceptSelected`: snapshot `Array.from(selectedIds)`; pre-filter proposals where `validateProposal` returns any error and count them as `skipped`. Set `bulkAction = { kind: "accepting", total: validIds.length, done: 0 }`. For each valid ID, `const outcome = await acceptProposal(id)` — increment `done` between iterations via `setBulkAction`. Use `outcome.status` to tally `accepted` vs `failed` directly. On completion, call `setStatusMessage(...)` with the summary text (see step #4) and reset `bulkAction = { kind: "idle" }`.
- `rejectSelected`: simpler — call `rejectProposal(id)` for each selected ID synchronously (the existing function is sync), then call `setStatusMessage("Rejected {count}")` and reset `bulkAction` to `idle`.
- Both must work even when `selectedIds` includes IDs that were already removed (defensive — filter against current `proposals` first).
- Per-card buttons (the existing accept/reject) must be disabled when `bulkAction.kind === "accepting"` or `"rejecting"`. The per-proposal **front Input and back Textarea** must also carry the same `disabled` gate — otherwise a user can edit a proposal after pre-validation has counted it as `skipped` (or vice versa), causing the recorded summary to misrepresent what was actually saved.

#### 4. Render bulk progress and summary block

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: When a bulk run is in progress, show "Accepting 3/12…" in the toolbar with a spinner. When the run finishes, replace it with an inline summary using the existing emerald/red block pattern.

**Contract**:
- Inside `renderReviewView`, beneath the toolbar, if `bulkAction.kind === "accepting" | "rejecting"`: render a `<div>` matching the existing generating-state banner pattern (`LoaderCircle` + text "Accepting {done + 1}/{total}…" or "Rejecting…").
- On bulk-run completion (inside `acceptSelected`/`rejectSelected`, after the loop), set the summary via the existing `statusMessage` channel: `setStatusMessage("Accepted {accepted}, rejected {rejected}{, skipped {skipped} (validation errors)}{, failed {failed} (network — retry available)}")`, then reset `bulkAction` to `{ kind: "idle" }`. The emerald `statusMessage` banner in `renderPasteView` already handles dismissal (existing close affordance at the banner level / its `setStatusMessage(null)` reset on next generate). Because `statusMessage` is rendered in `renderPasteView`, the summary remains visible whether the bulk run emptied the proposal list (state transitions back to `idle`) or partial cards remain (state stays `reviewing` and the summary is hidden behind `renderReviewView`; to handle that, ALSO render the same `statusMessage` block at the top of `renderReviewView` so partial-failure runs show the summary in-place).
- `finishIfLastProposal` (existing) already handles the "all proposals gone" transition — bulk paths must not bypass it.
- Tone-fidelity tradeoff: this routes both happy-path and partial-failure summaries through the single emerald `statusMessage` banner. If amber-vs-emerald tone proves necessary at impl-review, introduce a `statusTone: "success" | "warning"` slice rather than reviving the `bulkAction.summary` variant.

#### 5. Sync selectedIds with proposal mutations

**File**: `src/components/dashboard/GenerateFlashcards.tsx`

**Intent**: Whenever a proposal is removed from the `proposals` array (per-card accept success, per-card reject, or bulk), remove its ID from `selectedIds` to prevent stale references.

**Contract**: Inside the existing `flushSync` block in `acceptProposal` (where the resolved proposal is removed from `proposals`) and inside `rejectProposal` (synchronous removal), call `setSelectedIds((prev) => { const next = new Set(prev); next.delete(proposalId); return next; })` immediately after the `setProposals` mutation. Synchronous cleanup keeps the toolbar count and bulk-button gating consistent with the proposal list within the same React commit. Do NOT introduce a length-watching effect — `proposals.length` misses same-length mutations and runs after paint, leaving a stale-toolbar window.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npm run build`
- ESLint passes: `npm run lint`
- No new dependencies added to `package.json` (no toast library, no new shadcn primitive beyond what was added in Phase 1 — confirm via git diff).

#### Manual Verification:

- After AI generation completes, every proposal appears with its checkbox already ticked.
- Clicking "Select none" unchecks all proposals; "Select all" re-checks all. Selection count in the toolbar updates live.
- With all 8 proposals selected and valid, clicking "Accept selected" shows "Accepting 1/8…" → "Accepting 2/8…" → … progress; cards visibly disappear from the list as each completes; ends with "Accepted 8" summary.
- With 6 valid + 2 invalid (one empty front, one over-length back) proposals selected, "Accept selected" produces "Accepted 6, skipped 2 (validation errors)" and the 2 invalid cards remain in the list with their per-card error messages.
- Clicking "Reject selected" with a partial selection removes only the selected proposals; unselected ones remain.
- Per-card "Accept" / "Reject" buttons are disabled during a bulk run, re-enabled after.
- Per-card accept still works exactly as before (regression check) — including edited cards getting `source: ai_edited` and unedited ones getting `ai_full`.
- Pressing "Dismiss" clears the summary block.
- If a bulk-accept network call fails for one card, the summary reports it as `failed` and that card stays in the list with `saveError` populated.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 3.

---

## Phase 3: Review session reset

### Overview

Install the shadcn `AlertDialog` primitive and add a "Reset session" button to the review screen header. Confirming the dialog reloads the review queue from the API while leaving any FSRS ratings already persisted in Supabase untouched. The dialog must trap focus so the global `keydown` listener for `Space` / `1`–`4` doesn't fire behind it.

### Changes Required:

#### 1. Install shadcn AlertDialog primitive

**File**: `src/components/ui/alert-dialog.tsx` (new — generated by shadcn CLI)

**Intent**: Add the shadcn `AlertDialog` primitive so the reset confirm flow doesn't require building a modal from scratch.

**Contract**: Run `npx shadcn@latest add alert-dialog`. The generated file exports `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction`. No manual edits; the file appears alongside `button.tsx`.

#### 2. Add reset button to review session header

**File**: `src/components/dashboard/ReviewSession.tsx`

**Intent**: Render a small secondary-styled "Reset session" button in the `CardHeader` of `renderShell`, visible only when the user is actively in a session (`reviewing` / `revealed`). `submitting` is deliberately excluded — see contract note below.

**Contract**: In `renderShell`'s `<CardHeader>` right-hand cluster in [ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx), keep the existing `<span>` progress badge, then add an `<AlertDialogTrigger asChild>` wrapping a `<Button variant="outline" size="sm">` labeled "Reset". Render this trigger only when `state === "reviewing" || state === "revealed"` (deliberately excluding `"submitting"` — see note below). The `<AlertDialog>` provider wraps the entire `renderShell` `<section>`.

> Note: Reset is intentionally NOT exposed during `submitting`. A reset issued while `POST /api/flashcards/{id}/review` is in-flight would race the response: a failed POST resolving after `loadQueue` ran would clobber the freshly-loaded queue with `setState("error")` + `setError(...)`. The submit window is <1s; gating it out eliminates the race without AbortController plumbing.

#### 3. Wire confirm dialog content and action

**File**: `src/components/dashboard/ReviewSession.tsx`

**Intent**: Render the `AlertDialogContent` with title "Reset review session?", description "Reload the queue from scratch. Ratings already submitted will be kept.", a Cancel button, and a destructive-tone Confirm button that calls `loadQueue(practiceMode ? "practice" : "due")`.

**Contract**: Inside the `<AlertDialog>` wrapper, render `<AlertDialogContent>` with the standard shadcn structure: `<AlertDialogHeader>` with title + description as above, `<AlertDialogFooter>` with `<AlertDialogCancel>` ("Cancel") and `<AlertDialogAction>` ("Reload queue") whose `onClick` calls `void loadQueue(practiceMode ? "practice" : "due")`. `loadQueue` already resets `currentIndex` to 0, so no extra wiring is needed.

#### 4. Gate the global keydown listener while the reset dialog is open

**File**: `src/components/dashboard/ReviewSession.tsx`

**Intent**: Prevent the global `keydown` listener from grading the underlying card (or toggling reveal) while the reset `AlertDialog` is open. Radix's focus trap moves focus into the dialog but does NOT block window-level listeners, and `event.target` becomes a `BUTTON` element so the existing `isTyping` early-return (INPUT/TEXTAREA/contentEditable only) does NOT trip. The gate must be preemptive, not conditional on observed leaks.

**Contract**: Add `const [resetDialogOpen, setResetDialogOpen] = useState(false);`. Pass `open={resetDialogOpen}` and `onOpenChange={setResetDialogOpen}` to the `<AlertDialog>` wrapper. At the very top of `handleKeyDown` (before the `isTyping` check), add `if (resetDialogOpen) return;`. Include `resetDialogOpen` in the effect's dependency array so the listener picks up the latest value. This also blocks `Space`-to-reveal while the dialog is open, which is the intended behavior (Space activates the focused button inside the dialog).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `npm run build`
- ESLint passes: `npm run lint`
- The file `src/components/ui/alert-dialog.tsx` exists.

#### Manual Verification:

- "Reset" button appears in the review header during `reviewing` / `revealed` states; deliberately hidden during `submitting` to avoid racing the in-flight POST.
- "Reset" button is hidden on `loading`, `error`, `empty`, `practiceEmpty` states (those have their own retry / navigation UI).
- Clicking "Reset" opens a centered modal with title, description, Cancel, and Reload Queue buttons.
- Clicking Cancel (or pressing `Esc`) closes the modal with no state change — the same card is still shown at the same revealed/unrevealed state.
- Clicking "Reload Queue" closes the modal, briefly shows the skeleton loading state from Phase 1, then displays a fresh queue (in due mode or practice mode, matching the current session mode).
- While the dialog is open, pressing `1`, `2`, `3`, or `4` does NOT grade the underlying card (focus is trapped). Pressing `Space` does NOT toggle reveal.
- Cards graded BEFORE clicking reset retain their persisted FSRS state — verify by running review again later and confirming the graded card's `due` reflects the prior rating (use the Supabase studio or a manual query).
- After reset, the progress counter shows `1 / N` again.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering S-05 done.

---

## Testing Strategy

### Unit Tests:

This codebase does not currently ship a unit-test runner ([package.json](../../../package.json) has only `lint`, `build`, `dev`, `format`). Defer formal unit tests; rely on the manual verification steps above and a TypeScript-narrow guarantee (`npm run build`).

### Integration Tests:

No integration test infrastructure exists. The CI gate is `npm run lint` + `npm run build` ([.github/workflows/ci.yml](../../../.github/workflows/ci.yml)) — both must remain green after each phase.

### Manual Testing Steps (cross-phase):

1. **Cold start**: Hard-reload the dashboard. Confirm skeleton loaders (not plain text) show during the initial flashcard list fetch.
2. **Generate flow**: Paste 500 chars, click Generate. Verify the spinner banner + proposal skeletons appear during generating, then 8 proposals appear with all checkboxes ticked.
3. **Selection toggle**: Click "Select none" → no boxes ticked, bulk buttons disabled. Click "Select all" → all ticked. Manually uncheck 3 proposals → counter shows "5 of 8 selected".
4. **Bulk accept happy path**: With all 8 selected and valid, click Accept selected. Watch progress label increment; cards disappear; summary "Accepted 8" appears.
5. **Bulk accept with invalid**: Edit one card to have an empty front. Select all, click Accept selected. Result: "Accepted 7, skipped 1 (validation errors)"; the invalid card remains.
6. **Bulk reject**: Select 3, click Reject selected. Those 3 disappear, the other 5 remain.
7. **Review queue with skeletons**: Start a review session — verify skeleton blocks for front/back/rating row appear during queue load.
8. **Mid-session reset**: Reveal a card, grade it (Good). Reveal next card, do NOT grade. Click Reset → confirm → queue reloads; the card you graded is gone (it was due, now scheduled forward). Cards you didn't grade remain in the queue.
9. **Reset focus trap**: Open the reset dialog. Press `1`, `2`, `3`, `4`, `Space` — none of them should affect the underlying review card. Press `Esc` → dialog closes, card state unchanged.

## Performance Considerations

Bulk accept of 15 cards sequentially is roughly 15× the single-accept RTT (~150–300ms each on Cloudflare Workers), so up to 4–5 seconds of wall time. The progress indicator makes this tolerable. No optimization needed for the MVP scale; if AI generation ever returns 50+ proposals (it currently doesn't), revisit the parallel-vs-batch tradeoff in a follow-up.

## Migration Notes

No data migration. No schema changes. No API contract changes.

## References

- Roadmap entry: [context/foundation/roadmap.md#S-05](../../foundation/roadmap.md) (Stream D — UX polish)
- Existing AI candidate review component: [src/components/dashboard/GenerateFlashcards.tsx](../../../src/components/dashboard/GenerateFlashcards.tsx)
- Existing review session component: [src/components/dashboard/ReviewSession.tsx](../../../src/components/dashboard/ReviewSession.tsx)
- FSRS service: [src/lib/services/review.service.ts](../../../src/lib/services/review.service.ts)
- shadcn install convention: [AGENTS.md](../../../AGENTS.md) — `npx shadcn@latest add <name>`
- Loading-state lesson context: [context/foundation/lessons.md](../../foundation/lessons.md) (no Lodash; prefer native APIs — applies here as "prefer native checkbox over a new shadcn primitive unless review insists")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Loading-state primitives

#### Automated

- [x] 1.1 TypeScript compiles cleanly: `npm run build` — 9f1655e
- [x] 1.2 ESLint passes: `npm run lint` — 9f1655e
- [x] 1.3 The file `src/components/ui/skeleton.tsx` exists and exports `Skeleton` — 9f1655e
- [x] 1.4 No occurrence of the literal strings "Loading flashcards…", "Loading flashcards...", "Loading review queue…", or "Loading review queue..." remains under `src/components/` — 9f1655e

#### Manual

- [x] 1.5 Loading the dashboard's flashcard list shows shape-matching skeletons during the initial fetch — 9f1655e
- [x] 1.6 Starting a review session shows two large skeleton blocks + four rating-button skeletons during queue load — 9f1655e
- [x] 1.7 Triggering AI generation shows the spinner banner AND 3 proposal-shaped skeletons during generating — 9f1655e
- [x] 1.8 Per-card accept buttons in candidate review still show their LoaderCircle spinner during save (regression) — 9f1655e
- [x] 1.9 "Saving…" label on the flashcard form button still appears during submit (regression) — 9f1655e

### Phase 2: Bulk candidate actions

#### Automated

- [x] 2.1 TypeScript compiles: `npm run build`
- [x] 2.2 ESLint passes: `npm run lint`
- [x] 2.3 No new dependencies added to `package.json`

#### Manual

- [x] 2.4 After AI generation completes, every proposal appears with its checkbox already ticked
- [x] 2.5 "Select none" unchecks all; "Select all" re-checks all; selection count in toolbar updates live
- [x] 2.6 Bulk accept of 8 valid proposals shows progress "Accepting 1/8…" → … → ends with "Accepted 8" summary
- [x] 2.7 Bulk accept with 6 valid + 2 invalid produces "Accepted 6, skipped 2 (validation errors)" and invalid cards remain
- [x] 2.8 Reject selected removes only the selected proposals; unselected remain
- [x] 2.9 Per-card Accept/Reject are disabled during a bulk run and re-enabled after
- [x] 2.10 Per-card accept still works as before — `ai_full` vs `ai_edited` source attribution intact (regression)
- [x] 2.11 The summary `statusMessage` banner appears after a bulk run completes (visible in both `renderPasteView` after a list-emptying run and `renderReviewView` after a partial run) and clears on the next generate
- [x] 2.12 If a bulk-accept network call fails for one card, summary reports `failed` and that card stays in the list with `saveError`

### Phase 3: Review session reset

#### Automated

- [ ] 3.1 TypeScript compiles: `npm run build`
- [ ] 3.2 ESLint passes: `npm run lint`
- [ ] 3.3 The file `src/components/ui/alert-dialog.tsx` exists

#### Manual

- [ ] 3.4 "Reset" button appears in the review header during reviewing/revealed states (deliberately hidden during submitting to avoid the in-flight POST race)
- [ ] 3.5 "Reset" button is hidden on loading/error/empty/practiceEmpty/submitting states
- [ ] 3.6 Clicking Reset opens a centered modal with title, description, Cancel, and Reload Queue buttons
- [ ] 3.7 Clicking Cancel (or Esc) closes the modal with no state change
- [ ] 3.8 Clicking Reload Queue closes modal, shows skeleton briefly, then displays a fresh queue in the current session mode
- [ ] 3.9 While the dialog is open, pressing `1`/`2`/`3`/`4` does NOT grade the underlying card; pressing Space does NOT toggle reveal
- [ ] 3.10 Cards graded before reset retain their persisted FSRS state (verify via Supabase studio or later review session)
- [ ] 3.11 After reset, the progress counter shows `1 / N` again
