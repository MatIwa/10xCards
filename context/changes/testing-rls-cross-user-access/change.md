---
change_id: testing-rls-cross-user-access
title: Cross-user access tests for flashcards CRUD (Risk #3)
status: implementing
created: 2026-07-01
updated: 2026-07-01
archived_at: null
---

## Notes

- Test-plan rollout: kicks off Phase 2 (Server-boundary contracts) by covering **Risk #3** in isolation. Risks #4 (source-text retention) and #7 (untrusted input) are deferred to their own change folders per the user's step-by-step approach.
- Scope frozen at `/10x-research` step: flashcards CRUD only (list/detail/update/delete + create). Review/generation/account endpoints out of scope for this change.
- Test infra to reuse: `test/setup/global-integration.ts` from Phase 1 already seeds one integration user; this change will need a *second* user, either via an extended global setup or a per-test admin-client helper.
