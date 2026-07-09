---
change_id: testing-generate-privacy-and-input
title: Phase 2 slice: privacy and input validation on the generate endpoint
status: impl_reviewed
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Server-boundary contracts (auth, privacy, input)". This slice covers the remaining Phase 2 risks; Risk #3 already shipped via context/changes/testing-rls-cross-user-access/ — do not re-open it.

Risks covered: #4 (source-text non-retention on /api/flashcards/generate), #7 (server-side input validation on the same endpoint).
Test types planned: integration + unit.

Risk response intent (from §2 Risk Response Guidance):
- Risk #4: on both success and error paths of /api/flashcards/generate, the pasted source text does not appear in any DB row, any log line, the error response body, or persistent observability. Must challenge "we never call .insert() with the source text" — exception handlers that echo the request body are the usual leak.
- Risk #7: a POST /api/flashcards/generate with too-short, too-long, wrong-type, or missing-field body is rejected with a 400 before the LLM is called. Must challenge "the client validates" and "the LLM will handle it".

After creating the folder, follow the downstream continuation rule (suggest /10x-research as the next natural step; do not bounce back to /10x-test-plan).
