# Impl-review follow-ups — testing-ai-generation-critical-path

Source: `reviews/impl-review.md` (2026-07-01)

## For Phase 2 planning (cross-user RLS — Risk #3)

### F5 — Single shared `TEST_USER_ID` across integration tests

- **Where**: `test/setup/global-integration.ts:33-64` (globalSetup seeds one user; id lives on `process.env.TEST_SUPABASE_USER_ID`).
- **Why it becomes a problem in Phase 2**: cross-user RLS testing needs *two* users; and Phase 3 adds more integration files. Vitest defaults to file-parallel execution — two files sharing the same user id can (a) collide on truncate/reset, and (b) hide bugs where the harness itself becomes the reason a test passes.
- **Options for Phase 2 to pick between (do NOT decide here — that is `/10x-plan`'s job)**:
  1. Add a per-file suffix helper to `test/helpers/integration-user.ts`: `createTestUser(suffix)` seeds and returns a unique user. Keep the globalSetup user as the default; new tests that need a second user opt in.
  2. Keep the single user but disable file-parallelism: `poolOptions.threads.singleThread: true` for the integration project in `vitest.config.ts`. Simpler; costs some wall-clock time.
- **What Phase 2 planning must verify before choosing**: whether `db.ts::resetFlashcards()` (or its Phase 2 successor) safely handles two concurrent files with the current single-user model — the answer will tell you whether option 2 is enough or you need option 1.

## Fixed during triage (2026-07-01)

- F1 — mirrored `getServerEnvValue` guard into `src/lib/supabase.ts`; documented deviation in `plan.md` §Migration Notes.
- F2 — expanded `createCookieSink()` in `test/helpers/api-route-fetch-stub.ts` to implement the full `APIContext["cookies"]` surface backed by the session cookie header. Added a §6.6 cookbook note.
- F3 — deleted redundant `test/setup/env.ts`; `astro:env/server` alias in `vitest.config.ts` → `test/setup/astro-env-server.ts` is now the single source of truth. Comment about `TEST_*` env vars lives on the alias file.
- F4 — added an "Env mocks" bullet to test-plan §6.1 documenting when to use the alias vs `vi.hoisted` + getters.
