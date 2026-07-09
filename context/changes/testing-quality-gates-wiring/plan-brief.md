# CI Quality-Gates Wiring — Plan Brief

> Full plan: [plan.md](plan.md)
> Research: [research.md](research.md)

## What & Why

Wire the existing Vitest suite (unit + integration) into GitHub Actions as required gates on push/PR to `master`, closing rollout Phase 4 of [context/foundation/test-plan.md](../../foundation/test-plan.md). Phases 1–3 produced a suite covering Risks #1–#7; Phase 4 is the "actually enforced" half — without it, a green suite locally does not prevent regressions from landing on `master`.

## Starting Point

CI today runs one `ci` job (lint + build) and one `deploy` job (`needs: ci`, master push only). No test step exists in CI — that was explicitly deferred from Phase 1 until the suite was worth enforcing. Vitest projects (`unit`, `integration`), scripts (`npm test`, `npm run test:unit`, `npm run test:integration`), and integration infrastructure (Supabase-dependent global setup, per-test user harness) are all already in place locally.

## Desired End State

Every PR to `master` runs `ci` (lint + build + unit) and `integration` (Supabase + integration tests) in parallel. Both must be green for merge. `deploy` on master push also gates on both. Branch-protection on `master` lists `ci` and `integration` as required contexts, so red tests literally block the merge button — not just show a red X.

## Key Decisions Made

| Decision                          | Choice                                                                       | Why (1 sentence)                                                                                     | Source          |
| --------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------- |
| Job layout                        | Two jobs: `ci` (lint+build+unit) and `integration` (Supabase+integration)    | Cheap checks fail fast; integration only pays Supabase cost when reached; clean per-gate contexts.   | Plan            |
| Supabase spin-up scope            | Integration-job only, via `supabase/setup-cli@v3` + `supabase db start`      | Cheap checks (lint/build/unit) never pay the ~1–2 min Postgres boot cost.                             | Plan            |
| `deploy` dependency               | `needs: [ci, integration]`                                                   | Aligns with Phase 4's goal of preventing regressions from reaching master via the deploy path.        | Plan            |
| Required-status recording         | `gh api` PATCH command documented in `change.md` follow-up                   | Reproducible and greppable; single source of truth for what's required on `master`.                   | Plan            |
| Concurrency                       | Workflow-level `concurrency: { group: ci-<ref>, cancel-in-progress: true }`   | Stacked PR pushes stop double-charging CI minutes; standard hygiene.                                  | Plan            |
| Secrets                           | No new repo secrets                                                          | Local Supabase in CI generates its own ephemeral keys — service-role stays out of GitHub secrets.     | Research §4     |

## Scope

**In scope:**
- Extend `.github/workflows/ci.yml`: add `npm run test:unit` to the `ci` job, add a new `integration` job with Supabase, update `deploy: needs: [ci, integration]`, add workflow-level `concurrency:`.
- Document a `gh api` PATCH snippet in `change.md` that adds `ci` and `integration` to `master` branch protection.

**Out of scope:**
- No e2e / Playwright, no visual-diff, no AI-native gates (§7 negative-space).
- No composite action refactor, no Node-version matrix, no coverage upload.
- No Docker-image caching, no retry/flake mitigation (add only if signal emerges).
- No changes to pre-commit hooks or lint-staged config.
- No addition of `SUPABASE_SERVICE_ROLE_KEY` to repo secrets.

## Architecture / Approach

```
push / PR → master
    ├─ ci                (lint → test:unit → build)          ← required
    └─ integration       (supabase db start → test:integration) ← required
        └─ deploy        (needs: [ci, integration], master push only)
```

`supabase/setup-cli@v3` installs the CLI (version pinned via lockfile), `supabase db start` boots local Postgres and applies all migrations, then `supabase status -o env --override-name …` publishes `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` into `$GITHUB_ENV`. No secrets required. Required-status wiring on `master` happens once via `gh api` after the workflow has run at least one green PR (GitHub only surfaces contexts after their first appearance).

## Phases at a Glance

| Phase                                    | What it delivers                                                                  | Key risk                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Extend `ci` with unit + concurrency   | `test:unit` in the `ci` job + workflow-level cancel-in-progress                    | Unit-test failure blocks build unnecessarily if a flaky test slipped through Phase 1  |
| 2. Add `integration` job + gate `deploy` | New `integration` job with Supabase; `deploy` depends on both                     | `supabase db start` boot time (~1–2 min) or migration ordering surprises in CI        |
| 3. Wire required-status via `gh api`     | Both contexts become required on `master`; documented one-liner in `change.md`     | Must run *after* first PR completes; missed step leaves gates un-enforced             |

**Prerequisites:** Phase 3 test-suite work must be green on `master` (already true — see [context/foundation/test-plan.md §3](../../foundation/test-plan.md)). Repo admin must have `gh` CLI access with `repo` scope for Phase 3.

**Estimated effort:** One focused session across the three phases; Phase 3 is a documented one-liner that runs once.

## Open Risks & Assumptions

- **Integration flake risk in CI.** Local integration tests are green today, but CI runs against fresh Supabase each time — an ordering or race that never surfaced locally may surface on the runner. Mitigation: `testTimeout: 30000` already set in [vitest.config.ts](../../../vitest.config.ts); retries out of scope.
- **`supabase db start` boot time variance.** Docker image pull cache on GitHub-hosted runners is not guaranteed warm; first-run jobs may sit at ~90 s, cached ones closer to ~30 s. Not blocking but worth noting.
- **Assumption: no additional required contexts on `master` today beyond `ci`.** The `gh api` PATCH replaces the contexts array; if any hidden contexts exist they must be discovered and included in the same call. Plan calls this out explicitly.
- **Assumption: `supabase/setup-cli@v3` remains maintained and version-locked to lockfile behavior.** If the CLI adds a breaking change in a minor version, we would need to pin `version:` explicitly. Low risk today.

## Success Criteria (Summary)

- A PR with a broken integration test cannot be merged into `master` — merge button is blocked with "Required statuses must pass".
- A green PR merges normally; `deploy` on master push waits for both `ci` and `integration` before running `wrangler deploy`.
- No repo secrets were added or changed; no §7 negative-space gates were introduced; existing lint/build behavior is preserved.
