---
change_id: testing-account-deletion-and-fsrs-wiring
title: Testing account deletion completeness and FSRS wiring
status: implementing
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Phase 3 of the test-plan rollout (see `context/foundation/test-plan.md` §3). Prove Risks #5 and #6 as durable regression tests:

- **Risk #5** — Account deletion leaves orphan rows in a user-scoped table. Enforce the `lessons.md` rule that every user-scoped table must both cascade on `auth.users` delete AND be covered by the orphan-check in the deletion service. Integration test: seed a fixture row in every user-scoped table, delete, assert zero rows remain.
- **Risk #6** — FSRS wiring mistake (recall rating maps to wrong next-due state, or write-back targets wrong card/user). Unit test the pure wiring + one integration test round-tripping through the API. Assert we call ts-fsrs with (X, Y) and persist exactly what it returned — never assert a specific next-due date (that would test the library, not us).

Cookbook slots to fill on completion: §6.4 (new user-scoped table pattern) and §6.5 (FSRS wiring pattern).
