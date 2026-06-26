# Review Follow-ups: sr-review-session

Queued from `context/changes/sr-review-session/reviews/impl-review.md` triage.

## F2 — gradeCard: read-then-write without optimistic locking

- **Source**: impl-review.md F2 (OBSERVATION, MEDIUM impact, Safety & Quality)
- **Location**: src/lib/services/review.service.ts:96-117
- **Problem**: `gradeCard` performs SELECT → compute next FSRS state → UPDATE as two separate round-trips. Concurrent grades on the same card (e.g. two open tabs) will lose the first write. RLS scopes the risk to a single user's session but the lost-update is real.
- **Proposed fix**: Move read+compute+update into a single Postgres RPC (transactional), or add an optimistic check via `.update(...).eq("updated_at", original_updated_at)` and surface a 409 on mismatch.
- **Priority**: Low for MVP — bounded blast radius, no cross-user impact.
