<!-- PLAN-REVIEW-REPORT -->
# Plan Review: UX improvements (S-05)

- **Plan**: `context/changes/ux-improvements/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-24
- **Verdict**: REVISE
- **Findings**: 3 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓ (`skeleton.tsx` & `alert-dialog.tsx` correctly absent), key symbols (`acceptProposal`, `rejectProposal`, `flushSync`, `validateProposal`, `getSourceForProposal`, `loadQueue`, window `keydown` listener) ✓, brief↔plan ✓.

## Findings

### F1 — Bulk-accept cannot observe per-card outcomes (stale closure)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — step #3 ("Implement acceptSelected and rejectSelected")
- **Detail**: Plan says "After each await, check the resulting `proposals` state: if the proposal is still present and has a `saveError`, count as `failed`; if it's gone, count as `accepted`." But `acceptProposal` returns `void`, and the bulk loop closes over the `proposals` array captured at the start of the render — `flushSync` commits React state, but the loop's closure variable never updates. The loop cannot inspect post-call state with the current API surface, so accepted/failed counts cannot be computed.
- **Fix A ⭐ Recommended**: Refactor `acceptProposal` to return `{ status: "accepted" | "failed"; error?: string }`
  - Strength: Minimal invasive change; the return type is local to the component; `flushSync` invariant preserved.
  - Tradeoff: Two call sites need updating (per-card button + bulk loop).
  - Confidence: HIGH — direct, idiomatic React; no closure gymnastics.
  - Blind spot: None significant.
- **Fix B**: Read latest state via `setProposals` callback inside the loop
  - Strength: No signature change to `acceptProposal`.
  - Tradeoff: Abuses setState as a state-reader; ESLint/React reviewers will flag this; brittle to future renderer changes.
  - Confidence: MEDIUM — works today but is a code smell.
  - Blind spot: Concurrent-mode behavior with this pattern is unverified.
- **Decision**: FIXED via Fix A — `acceptProposal` returns `{ status: "accepted" | "failed"; error?: string }`; bulk loop reads outcomes directly.

### F2 — Bulk-accept happy-path summary never renders

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — step #4 ("Render bulk progress and summary block")
- **Detail**: When the bulk loop accepts the last proposal, `acceptProposal` calls `finishIfLastProposal` (`proposals.length` now 0) which transitions `state` to `"idle"` and clears `sourceText`. The bulk handler then sets `bulkAction.kind === "summary"`, but the summary block lives inside `renderReviewView`, which is only shown when `state === "reviewing"` (see [GenerateFlashcards.tsx](../../../../src/components/dashboard/GenerateFlashcards.tsx) `CardContent` switch). On the happy path (all selected accepted, list emptied) the "Accepted 8" summary never appears — exactly success criterion 2.6.
- **Fix**: Route bulk summaries through `setStatusMessage(...)` instead of `bulkAction.summary`. The emerald status banner already renders in `renderPasteView` (the idle-state view). Reserve `bulkAction.kind === "accepting"|"rejecting"` only for the in-progress label; on completion call `setStatusMessage("Accepted 8, skipped 2 (validation errors)")` and reset `bulkAction` to `idle`.
  - Strength: Reuses the existing cross-state status channel; summary visible whether the list empties or partial cards remain.
  - Tradeoff: Loses the dismissible amber-vs-emerald distinction; all summaries share one banner style.
  - Confidence: HIGH — pattern is already in use by `generateCards`.
  - Blind spot: Partial-failure (mixed accepted+failed) loses the amber tone unless a status-tone slice is added.
- **Decision**: FIXED via single fix — bulk summaries routed through `setStatusMessage(...)`; `bulkAction.summary` variant removed; summary also rendered at top of `renderReviewView` to cover partial-failure case. Manual check 2.11 updated.

### F3 — Window-level keydown listener bypasses AlertDialog focus trap

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — step #4 ("Verify keyboard isolation")
- **Detail**: The grading keydown handler is attached to `window` ([ReviewSession.tsx](../../../../src/components/dashboard/ReviewSession.tsx) ~L176). Radix's AlertDialog focus trap moves focus INTO the dialog but does NOT stop window-level listeners from firing. When the dialog is open and a Cancel/Action button is focused, `event.target.tagName === "BUTTON"`, so the `isTyping` early-return (INPUT/TEXTAREA/contentEditable only) does NOT trip. If `state === "revealed"` and the user presses `1`–`4`, the underlying card is graded behind the modal. This is structural, not probabilistic — success criterion 3.9 will fail without a preemptive gate.
- **Fix**: Add the dialog-open gate preemptively, not conditionally. Track a `resetDialogOpen` state synced to AlertDialog's `onOpenChange`; at the top of `handleKeyDown`, return early if `resetDialogOpen`. (DOM-query fallback works but couples to Radix's `data-state` attribute.)
  - Strength: One-line gate; state-driven, no DOM coupling.
  - Tradeoff: Adds one `useState` + one `onOpenChange` handler.
  - Confidence: HIGH — standard React pattern.
  - Blind spot: Also gates `Space`-to-reveal; that's intended.
- **Decision**: FIXED via single fix — added preemptive `resetDialogOpen` gate to `handleKeyDown`; updated Critical Implementation Details accordingly.

### F4 — Reset during `"submitting"` races the in-flight grade POST

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — step #2 + success criterion 3.4
- **Detail**: Plan exposes Reset during `reviewing`/`revealed`/`submitting`. If the user clicks Reset while a `POST /api/flashcards/{id}/review` is in-flight, `loadQueue` sets state to `"loading"`. When the pending POST resolves on failure, its catch handler runs `setState("error")` + `setError(...)` (ReviewSession.tsx ~L149–L151), clobbering the freshly-loaded queue UI. User lands on an error screen with the prior card's failure text.
- **Fix**: Restrict Reset visibility to `state === "reviewing" || state === "revealed"`. Drop `submitting`. The submit window is <1s; gating it out eliminates the race.
  - Strength: Trivial; no AbortController plumbing.
  - Tradeoff: User briefly cannot reset during a rating submit.
  - Confidence: HIGH — submit lifecycle is short.
  - Blind spot: If submit ever becomes long-running, revisit.
- **Decision**: FIXED via single fix — dropped `submitting` from Reset visibility everywhere (Desired End State, Implementation Approach, Phase 3 step #2, SC 3.4/3.5).

### F5 — Front/back inputs editable during bulk run can mutate proposals mid-batch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — step #3
- **Detail**: Plan disables per-card Accept/Reject buttons during a bulk run but doesn't disable the front/back Input/Textarea. A user can edit a proposal after pre-validation has counted it as `skipped` (invalid) but before the loop reaches it — or vice versa. The recorded outcome then misrepresents what was actually saved.
- **Fix**: Add `disabled={bulkAction.kind === "accepting" || bulkAction.kind === "rejecting"}` to the front Input and back Textarea, mirroring the per-card button disable.
- **Decision**: FIXED — bulk-disable now also covers per-proposal front Input and back Textarea (Phase 2 step #3 contract).

### F6 — `selectedIds` cleanup via length-watching effect is fragile

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — step #5
- **Detail**: Plan: "Easiest implementation: derive `selectedIds` cleanup in the same `setProposals` updater via a follow-up effect that watches `proposals.length`." A length-only watcher misses same-length mutations and runs AFTER paint, leaving a window where toolbar counts and bulk-button gating compute against stale IDs.
- **Fix**: Clean `selectedIds` synchronously inside the existing `flushSync` blocks in `acceptProposal` (~L272) and `rejectProposal` (~L219): `setSelectedIds((prev) => { const next = new Set(prev); next.delete(proposalId); return next; })`. No effect needed.
- **Decision**: FIXED — Phase 2 step #5 rewritten to clean `selectedIds` synchronously inside `flushSync` blocks; effect-based cleanup explicitly rejected.

### F7 — Plan cites stale line numbers (off by 1–18)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Multiple — Current State Analysis and Phase 2/3 steps
- **Detail**: Stale anchors: `acceptProposal` cited L223 → actual L228; `rejectProposal` cited L235 → actual L217; `renderReviewView` cited L389 → actual L377; `<li>` cited L398 → actual L393; FlashcardForm "Saving…" cited L145 → actual L193. Symbol names are correct, so `grep` recovers — but every reference costs a few seconds.
- **Fix**: Drop line numbers and reference by symbol name only; or refresh before handoff.
- **Decision**: FIXED — all `L###` anchors and `#L###` URL fragments removed; remaining references use symbol names.

### F8 — Phase 1 grep criterion misses the three-dot "Loading flashcards..." variant

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — success criterion 1.4
- **Detail**: Criterion greps for `"Loading flashcards…"` (curly ellipsis) but the file uses `"Loading flashcards..."` (three dots). For "review queue" both variants are listed; for "flashcards" only the curly ellipsis is. The check would pass while the text remains.
- **Fix**: Add `"Loading flashcards..."` (three dots) to the literal list.
- **Decision**: FIXED — added three-dot `"Loading flashcards..."` variant to both Desired End State SC literal list and Progress entry 1.4.
