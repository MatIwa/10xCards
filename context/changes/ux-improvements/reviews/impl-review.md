<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UX improvements (S-05)

- **Plan**: context/changes/ux-improvements/plan.md
- **Scope**: All 3 phases (Phase 1: loading-state primitives; Phase 2: bulk candidate actions; Phase 3: review session reset)
- **Date**: 2026-06-26
- **Verdict**: APPROVED (1 warning, 2 observations)
- **Findings**: 0 critical · 1 warning · 2 observations
- **Commits reviewed**: 9f1655e (P1) · ddbc84f (P2) · 741ab95 (P3) · c2b0cbc (epilogue)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification

- `npm run lint` — ✅ green
- `npm run build` — ✅ green (one pre-existing esbuild CSS minify warning on a Tailwind selector `[file\:line]`, unrelated to this change)
- `src/components/ui/skeleton.tsx` — exists, exports `Skeleton`
- `src/components/ui/alert-dialog.tsx` — exists, exports the full primitive set
- No `"Loading flashcards…"` / `"Loading flashcards..."` / `"Loading review queue…"` / `"Loading review queue..."` literals remain under `src/components/`
- No new entries in `package.json` (note: this is what F1 flags — the shadcn install for AlertDialog skipped declaring its direct dep)

## Findings

### F1 — alert-dialog.tsx imports an undeclared transitive dep

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/alert-dialog.tsx:1
- **Detail**: The new file imports `@radix-ui/react-alert-dialog` directly, but that package is NOT in `package.json` — it resolves only as a transitive dep of `radix-ui@1.4.3` (umbrella, declared at package.json:31). Build passes today because npm hoists it to top-level `node_modules`, but the contract is fragile: a `radix-ui` minor that drops the primitive, an `npm ci` with stricter resolution (pnpm / yarn-pnp / `--legacy-peer-deps` flips), or a Renovate bump can silently break the import. Sibling pattern is split — `src/components/ui/button.tsx:2` declares `@radix-ui/react-slot` directly (package.json:21), while `src/components/ui/label.tsx:2` uses `from "radix-ui"` umbrella. The new file follows neither — it imports a scoped Radix package without declaring it. The shadcn CLI normally adds the direct dep alongside the file; that step was skipped or rolled back.
- **Fix A ⭐ Recommended**: Declare the direct dep — run `npm install @radix-ui/react-alert-dialog@^1.1.15` (the version already resolved) and commit `package.json` + `package-lock.json`.
  - Strength: Matches what shadcn would have done; aligns with `button.tsx`'s explicit-direct-dep pattern; survives any future change to the `radix-ui` umbrella.
  - Tradeoff: Slightly larger surface in `package.json` (one entry).
  - Confidence: HIGH — identical to existing pattern at package.json:21 for `@radix-ui/react-slot`.
  - Blind spot: None significant.
- **Fix B**: Rewrite the import to the umbrella package — change line 1 to `import { AlertDialog as AlertDialogPrimitive } from "radix-ui";` and update internal references accordingly.
  - Strength: Matches the newer `label.tsx` pattern; no `package.json` change needed.
  - Tradeoff: Forks the file away from upstream shadcn — future `npx shadcn add` re-runs will regenerate with the direct import and re-introduce the issue; namespace rebind is a non-trivial rewrite vs. a one-line install.
  - Confidence: MEDIUM — pattern exists in this repo but is the minority shape.
  - Blind spot: Haven't verified the umbrella exposes every primitive used (`AlertDialogPrimitive.Action`, `.Cancel`, `.Title`, etc.) without API divergence.
- **Decision**: FIXED via Fix A — installed `@radix-ui/react-alert-dialog@^1.1.17` as a direct dep; `package.json` line 21 now declares it; lint green.

### F2 — Redundant aria-label on proposal checkbox

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/dashboard/GenerateFlashcards.tsx:605-619
- **Detail**: The proposal checkbox carries both `aria-label="Select proposal N"` (line 609) AND an associated `<Label htmlFor={checkboxId}>Proposal N</Label>` (line 617). The `aria-label` overrides the linked `<Label>` for assistive tech — screen readers announce "Select proposal N" while the visible label reads "Proposal N". Both convey the same info, so it works, but it's a minor accessibility-naming inconsistency.
- **Fix**: Drop the `aria-label` attribute on the `<input>` (line 609). The visible `<Label htmlFor={checkboxId}>` already provides the accessible name.
- **Decision**: FIXED — removed `aria-label` from the proposal checkbox at GenerateFlashcards.tsx:609; the `<Label htmlFor={checkboxId}>` below now provides the sole accessible name; `npm run lint` passes.

### F3 — Double setStatusMessage on bulk-reject completion

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/dashboard/GenerateFlashcards.tsx:295-303, 433-451
- **Detail**: When `rejectSelected` empties the proposal list, the final `rejectProposal` call runs `finishIfLastProposal([], savedCount)` which sets `statusMessage = "0 cards saved. Paste more text…"` (line 219). Then the loop exits and `setStatusMessage(\`Rejected \${count}\`)` (line 449) overwrites it. The writes are batched (the second is not inside `flushSync`), so React commits them together and the user only sees "Rejected N". No bug today — but the cascade makes the intent harder to read and creates a future-edit landmine: any change that adds a render between the two writes would flash the wrong message.
- **Fix**: In `rejectProposal`, move the `finishIfLastProposal(...)` call out of the function and into its call sites — per-card reject button calls it after `rejectProposal`; `rejectSelected` calls it once, AFTER the loop, AFTER `setStatusMessage(\`Rejected …\`)`, so the tail emits one consistent message in either path.
- **Decision**: FIXED — `rejectProposal` now returns `ProposalState[]` (the filtered list) and no longer calls `finishIfLastProposal`. Per-card reject button at GenerateFlashcards.tsx:685-695 calls `finishIfLastProposal(nextProposals, savedCount)` immediately after; `rejectSelected` at GenerateFlashcards.tsx:430-454 threads `nextProposals` through the loop and calls `finishIfLastProposal` exactly once at the tail, after `setStatusMessage(\`Rejected N\`)`. Lint + build green.

## Plan-drift summary

All 14 high-risk contract points across Phases 1–3 verified as MATCH:

- Phase 1.2 (FlashcardList: 3 list-shaped skeletons in `space-y-3`) — MATCH at FlashcardList.tsx:119-124
- Phase 1.3 (ReviewSession loading: two h-44 + four h-12 skeletons) — MATCH at ReviewSession.tsx:117-130
- Phase 1.4 (GenerateFlashcards generating: spinner banner + 3 proposal skeletons) — MATCH at GenerateFlashcards.tsx:559-567
- Phase 2.1 (`selectedIds: Set<string>` + `BulkAction` union; summary routed through `statusMessage`, not a 4th `BulkAction` variant) — MATCH at GenerateFlashcards.tsx:40-41, 99-100, 213
- Phase 2.2 (toolbar with flipping "Select all/none" label, count display, both bulk buttons; per-card checkboxes with `useId`-stable IDs; per-card buttons preserved) — MATCH at GenerateFlashcards.tsx:596-614, 667-677
- Phase 2.3 (`acceptProposal` returns `AcceptOutcome`; sequential awaits; validation pre-filter; per-card Input/Textarea disabled during bulk) — MATCH at GenerateFlashcards.tsx:296-349, 685-686
- Phase 2.4 (progress label "Accepting {done+1}/{total}…"; summary text format; `renderStatusMessage` rendered in both paste and review views) — MATCH at GenerateFlashcards.tsx:412-419, 514, 592, 617-625
- Phase 2.5 (synchronous `setSelectedIds` cleanup inside `flushSync`, not a length-watching effect) — MATCH at GenerateFlashcards.tsx:300, 348
- Phase 3.2 (Reset button visible only in `reviewing`/`revealed`, hidden in `submitting`) — MATCH at ReviewSession.tsx:263-273
- Phase 3.3 (`AlertDialogAction` onClick calls `loadQueue(practiceMode ? "practice" : "due")`) — MATCH at ReviewSession.tsx:275-290
- Phase 3.4 (`resetDialogOpen` controlled state; `if (resetDialogOpen) return;` AT THE TOP of `handleKeyDown`, before `isTyping`; `resetDialogOpen` in effect deps) — MATCH at ReviewSession.tsx:175, 187-189, 203

Helpers added beyond the explicit plan (`removeSelectedId`, `toggleSelectedId`, `toggleAllSelected`, derived `isBulkRunning`/`allSelected`/`selectedCount`, the `<AlertDialog>` provider wrapping `renderShell`) are necessary plumbing for the planned contract and carry no risk — not flagged as scope creep.

## How to resume triage

Run `/10x-impl-review context/changes/ux-improvements/reviews/impl-review.md` to walk through the 3 findings interactively.
