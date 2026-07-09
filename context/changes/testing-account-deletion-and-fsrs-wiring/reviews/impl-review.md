<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account deletion completeness + FSRS wiring

- **Plan**: context/changes/testing-account-deletion-and-fsrs-wiring/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-07-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- **Diff scope** matches plan: `src/lib/services/account.service.ts` + 4 new test files + `context/foundation/test-plan.md` §6.4/§6.5/§6.6. No unplanned edits.
- **Lint**: `npm run lint` passes (no violations).
- **Unit**: `npm run test:unit -- account.service review.service` → 17 passed (5 account + 12 review). Matches plan count exactly.
- **Integration**: success criteria affirmed by `## Progress` checkboxes with commit SHAs (`260f0bd`, `ecb3ae6`).
- **lessons.md rule** ("user-scoped tables must cascade AND be in orphan-check") is materially enforced by the `USER_SCOPED_TABLES` const + roster-equality guard — a strong three-layer defense (marker comment → runtime enumeration → test-time equality).

## Findings

### F1 — previewRatings it.each iterates identical body

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/review.service.test.ts:107
- **Detail**: `it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])` passes `_rating` (unused). Since `previewRatings` maps all four ratings in one call, the test body runs identically four times. Coverage is complete; the parameterisation is misleading.
- **Fix**: Convert to a single `it("returns due dates for all four ratings", ...)` (drop the `it.each`). Same coverage, less noise.
- **Decision**: FIXED

### F2 — Integration test location split

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/review.service.integration.test.ts
- **Detail**: `review.service.integration.test.ts` lives under `src/lib/services/`, while all other integration tests (`test/rls/…`, `test/api/…`, `test/account-deletion/…`) live under `test/`. Plan named the path explicitly, so this is plan-approved — but it leaves two conventions in the repo. Future contributors may not know which to follow.
- **Fix**: Either move to `test/review/review.service.integration.test.ts` to unify, OR document the split in test-plan.md §6 (e.g., "service-adjacent integration tests may co-locate"). No functional impact either way.
- **Decision**: FIXED — moved to `test/review/review.service.integration.test.ts`; plan.md + test-plan.md references updated.

### F3 — Audit-log assertion assumes zero incidental logs

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/account-deletion/account-delete.integration.test.ts:126
- **Detail**: `expect(logSpy).toHaveBeenCalledTimes(1)` breaks if any code path in the delete flow (endpoint, middleware, signOut) ever emits an incidental `console.log`. Today the audit line is the only such log, so the assertion passes — but the test implicitly couples to that "nothing else logs" invariant.
- **Fix**: Filter `logSpy.mock.calls` for parseable JSON payloads with `event === "account_deleted"` and assert length === 1 on the filtered set. Same signal, resilient to unrelated logging.
- **Decision**: FIXED
