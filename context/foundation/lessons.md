# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Do not add Lodash without a clear reason

- **Context**: Implementation of functions in a TypeScript application on the frontend and backend.
- **Problem**: The developer used `_.filter()` even though Lodash is not part of the project. This would add an unnecessary dependency and violate the local convention of using native APIs.
- **Rule**: Do not add Lodash without a clear indication. The project prefers native JS/TS functions in the 2026+ standard.
- **Applies to**: plan, implement, impl-review

## User-scoped tables must cascade on `auth.users` delete AND be covered by the orphan-check

- **Context**: Account deletion (GDPR) requires complete erasure of all user-owned rows when an `auth.users` row is deleted via `auth.admin.deleteUser`. The deletion endpoint runs a post-delete verification that queries every user-scoped table and returns 500 if any orphan rows remain.
- **Problem**: When a new user-scoped table is added (any table whose rows belong to a specific user), it's easy to declare the `user_id` column without `on delete cascade`, OR to add the cascade but forget to extend `src/lib/services/account.service.ts` to include the new table in the orphan-check. The first failure silently leaves orphan rows in the database after deletion. The second failure makes the endpoint certify "complete erasure" while orphans persist — a GDPR contract break.
- **Rule**: Any new table with a `user_id` column referencing `auth.users(id)` MUST (a) declare `on delete cascade` in its migration AND (b) be added to the orphan-check in `src/lib/services/account.service.ts` (the `deleteAccount` verification step). Both edits land in the same change. Plans that introduce user-scoped tables must include both steps explicitly; reviewers flag a missing cascade or a missing orphan-check entry as a critical finding.
- **Applies to**: plan, implement, impl-review, plan-review


## Do not bundle ambient hygiene commits into a scoped change PR

- **Context**: `.gitignore` entries for `.github/skills/`, `.agents/skills/`, and `skills-lock.json` were added inside PR #17 (change `testing-quality-gates-wiring`) whose `What We're NOT Doing` boundary is strictly about CI shape.
- **Problem**: Unrelated hygiene edits (gitignore, tooling churn, editor config, dep bumps) landing inside a scoped change PR (a) break atomicity — the PR is no longer a single reviewable unit and rollback nukes unrelated cleanup, (b) evade the PR title/description contract so reviewers don't see them, and (c) surface as scope-discipline warnings in `/10x-impl-review` even when the individual edits are correct.
- **Rule**: Ambient hygiene changes (gitignore, formatting configs, dep updates, incidental cleanup) MUST land in a separate small PR titled `chore: ...`, never inside a scoped change PR. If the hygiene edit is genuinely required for the change to work, call it out explicitly in the plan's `## What We're NOT Doing` / scope section BEFORE implementing.
- **Applies to**: implement, impl-review
