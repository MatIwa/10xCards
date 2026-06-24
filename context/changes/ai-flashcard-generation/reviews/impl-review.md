<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Flashcard Generation

- **Plan**: context/changes/ai-flashcard-generation/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension            | Verdict |
|----------------------|---------|
| Plan Adherence       | WARNING |
| Scope Discipline     | WARNING |
| Safety & Quality     | WARNING |
| Architecture         | PASS    |
| Pattern Consistency  | PASS    |
| Success Criteria     | PASS    |

## Findings

### F1 — Model ID differs from the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/ai-generation.service.ts:14
- **Detail**: Plan pins `MODEL_ID` to `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` and documents a live smoke test (JSON-mode + `usage.cost: 0`). Implementation uses `liquid/lfm-2.5-1.2b-instruct:free` instead — a smaller, different free-tier model with no documented smoke test, no rationale in code comments, no addendum in `change.md`. Quality and latency profile of the actually-shipped model are not on record.
- **Fix A ⭐ Recommended**: Update plan + add code comment to ratify the swap
  - Strength: Preserves working code already verified by manual checks 1.5/2.4/3.7. Documents WHY for the next agent reading the service module.
  - Tradeoff: Plan becomes a slightly moving target; the original smoke-test evidence becomes stale.
  - Confidence: HIGH — repo treats plan addenda as legitimate per prior reviews.
  - Blind spot: Haven't compared output quality of the two models side-by-side on the same input.
- **Fix B**: Revert MODEL_ID to the planned nemotron model
  - Strength: Restores plan ↔ code alignment; relies on the documented smoke test.
  - Tradeoff: Need to re-run manual checks 1.5 and 3.7 against the swapped model; risk of regression in output quality the user already saw working with liquid.
  - Confidence: MEDIUM — plan's smoke test was done some time ago; free-tier model availability on OpenRouter shifts.
  - Blind spot: Haven't checked whether nemotron is still free / reachable today.
- **Decision**: FIXED via Fix A (code comment in `ai-generation.service.ts`, plan addendum A1, change.md note)

### F2 — Generation timeout shorter than planned (30s/35s vs 60s)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/ai-generation.service.ts:15; src/components/dashboard/GenerateFlashcards.tsx:47
- **Detail**: Plan §Phase 1 specifies a 60-second `AbortController` timeout. Implementation uses 30s on the server and 35s on the client. No rationale in code or `change.md`. With a 25,000-char input on a free-tier model, p99 latency can plausibly exceed 30s — risk of false-positive `provider_unavailable` errors surfacing to the user.
- **Fix**: Align both timeouts to the planned 60s (server-side `60_000`, client-side ≥ `60_000` so the user-facing `AbortController` never fires before the server-side one), or update the plan with a justified rationale for the shorter bound.
- **Decision**: FIXED via plan addendum A2 (kept 30s/35s; documented rationale and accepted risk — no code change)

### F3 — Stale closure in `acceptProposal` clobbers concurrent state updates

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/dashboard/GenerateFlashcards.tsx:262-265
- **Detail**: On a successful Accept, the success path reads `proposals` and `savedCount` from closure rather than via functional setState:

  ```ts
  const nextSavedCount = savedCount + 1;
  const nextProposals = proposals.filter((item) => item.id !== proposalId);
  setSavedCount(nextSavedCount);
  setProposals(nextProposals);
  ```

  Per-proposal `isSaving` only disables the button for that one proposal, so the user can click Accept on proposal B while A is still in flight. When A's response returns, it sets proposals from the closure-captured array (still includes B). When B's response returns, it sets proposals from its own captured array (still includes A). Net effect: an accepted card can reappear, and `savedCount` undercounts (both calls write `0 + 1`, not `1 + 1`). The error and `saveError` branches earlier in the same function already use the functional form — only the success path regressed.
- **Fix**: Switch the success branch to functional `setState` so each update composes onto the latest committed state:

  ```ts
  setSavedCount((prev) => prev + 1);
  setProposals((prev) => {
    const next = prev.filter((item) => item.id !== proposalId);
    finishIfLastProposal(next, /* derive from prev.length === 1 or a ref */);
    return next;
  });
  ```

  `finishIfLastProposal` also needs to read the freshest counts — consider deriving "is this the last one" from `prev.length === 1` inside the functional updater rather than the closure value.
- **Decision**: FIXED via `flushSync` + functional setState in both `acceptProposal` success branch and `rejectProposal` (initial `useEffect` approach was rejected by `react-hooks/set-state-in-effect`; `flushSync` preserves the `finishIfLastProposal` helper and ensures concurrent Accept resolutions read the latest committed state). Lint + `astro check` clean.

### F4 — Unrelated `review.service.ts` edit folded into Phase 1 commit

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/services/review.service.ts:39
- **Detail**: Commit `de9f8f9` (Phase 1) added a single line to a file unrelated to the AI feature:

  ```diff
  + // eslint-disable-next-line @typescript-eslint/no-deprecated -- The current flashcards schema stores this ts-fsrs field.
        elapsed_days: card.elapsed_days,
  ```

  The change silences an `elapsed_days` deprecation hint. The eslint-disable comment doesn't fully suppress the TS-Check hint (`astro check` still shows `ts(6385): 'elapsed_days' is deprecated`). It's an incidental lint fix benign in isolation, but plan §"What We're NOT Doing" doesn't cover it and `change.md` doesn't mention it. Not enough to block, but worth flagging so future agents don't see it as precedent for piggybacking edits.
- **Fix**: No code change required. Note in `change.md` under the Phase 1 section that an incidental eslint-disable was applied to `review.service.ts` to keep lint clean across the touched dependency surface.
- **Decision**: SKIPPED (observation only; user opted not to record)
