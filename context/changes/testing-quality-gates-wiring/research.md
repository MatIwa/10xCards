---
date: 2026-07-09T00:00:00Z
researcher: GitHub Copilot
git_commit: ae4826394bb577be3e10ff0267f7e93aa396e7b2
branch: master
repository: MatIwa/10xCards
topic: "Wiring the Vitest suite into GitHub Actions CI as a required gate on push/PR (test-plan §3 Phase 4)"
tags: [research, codebase, ci, github-actions, vitest, supabase, quality-gates]
status: complete
last_updated: 2026-07-09
last_updated_by: GitHub Copilot
---

# Research: CI Quality-Gates Wiring for the Test Suite

**Date**: 2026-07-09
**Researcher**: GitHub Copilot
**Git Commit**: `ae4826394bb577be3e10ff0267f7e93aa396e7b2`
**Branch**: `master`
**Repository**: `MatIwa/10xCards`

## Research Question

Rollout Phase 4 of [context/foundation/test-plan.md](context/foundation/test-plan.md) — "Quality-gates wiring in CI". Enforce the Vitest suite (unit + integration) as a required CI check on push/PR without regressing existing lint/build gates and without adding anything §7 negative-space (no e2e, no visual-diff, no AI-native). Concretely: how the current CI is shaped, what integration tests need at runtime, how to bring local Supabase up inside GitHub Actions, and how "required" is actually enforced.

## Summary

- **Current CI is minimal and clean.** A single `ci` job runs `npm ci` → `astro sync` → `npm run lint` → `npm run build`, and a separate `deploy` job (`needs: ci`, master push only) runs `wrangler deploy`. There is **no test step at all** — this was deliberate, deferred until Phases 1–3 produced a suite worth enforcing. See [.github/workflows/ci.yml](.github/workflows/ci.yml).
- **The suite is now worth enforcing.** Vitest runs two projects (`unit`, `integration`) via [vitest.config.ts](vitest.config.ts#L18-L45). Scripts already exist: `npm test`, `npm run test:unit`, `npm run test:integration` ([package.json](package.json#L7-L9)).
- **Integration tests depend on a live local Supabase.** The global setup in [test/setup/global-integration.ts](test/setup/global-integration.ts#L4-L21) hard-exits when `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` are missing, then seeds a shared test user via `auth.admin.createUser`. Unit tests do **not** need Supabase.
- **Bringing Supabase up in CI is well-trodden.** The official `supabase/setup-cli@v3` composite action installs the CLI, `supabase db start` applies migrations, and `supabase status -o env --override-name api.url=… --override-name auth.service_role_key=…` exports env vars in the exact shape our tests want. Docker is available on `ubuntu-latest` out of the box.
- **"Required" is a branch-protection setting, not a workflow file change.** Adding jobs to `ci.yml` makes them run; adding their check names to the required-status list in the repo's `master` branch-protection rule is what blocks merge. Job/step names in the workflow become the check contexts.
- **Two design decisions are open for `/10x-plan`.** (a) Single-job vs. split (`ci` for lint+build+unit, `integration` as its own job with Supabase). (b) Whether `deploy` should also gate on the test job(s) (currently `needs: ci` only). Neither is answered in prior changes.

## Detailed Findings

### 1. Current CI shape

Current workflow file — [.github/workflows/ci.yml](.github/workflows/ci.yml):

- Trigger: `push` to `master` and `pull_request` targeting `master`.
- Job `ci` on `ubuntu-latest`:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version: 22`, `cache: npm`
  3. `npm ci`
  4. `npx astro sync`
  5. `npm run lint`
  6. `npm run build` with `SUPABASE_URL` / `SUPABASE_KEY` from repo secrets (Astro build reads the env schema; keys can be present since the values are anon-safe).
- Job `deploy`: `needs: ci`, gated by `if: github.event_name == 'push' && github.ref == 'refs/heads/master'`, checks out again, re-runs `npm ci` + `npm run build`, then `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.

**Implication for Phase 4:** The `ci` job is the only existing branch-protection surface. Adding a test step to `ci` (or introducing a sibling `test` job) is the simplest path; there is no prior split-by-concern precedent to preserve.

### 2. Vitest project shape and scripts

[vitest.config.ts](vitest.config.ts) defines two projects under one root config:

- **`unit`** ([vitest.config.ts:L19-L28](vitest.config.ts#L19-L28))
  - `environment: node`
  - `include: ["src/**/*.test.ts"]`, `exclude: ["src/**/*.integration.test.{ts,tsx}"]`
  - No global setup, no Supabase. Alias only for `@` and the two `astro:*` stubs.
- **`integration`** ([vitest.config.ts:L29-L44](vitest.config.ts#L29-L44))
  - `environment: jsdom`
  - `include: ["src/**/*.integration.test.{ts,tsx}", "test/**/*.integration.test.{ts,tsx}"]`
  - `setupFiles: ["./test/setup/jest-dom.ts"]`
  - `globalSetup: ["./test/setup/global-integration.ts"]`
  - `testTimeout: 30000`

[package.json](package.json#L7-L9) scripts:
- `"test": "vitest run"` — both projects.
- `"test:unit": "vitest run --project unit"`.
- `"test:integration": "vitest run --project integration"`.

**Implication for Phase 4:** The unit project is a cheap, no-infrastructure job (`npm run test:unit`). The integration project is what pulls in the Supabase requirement. This is the natural split axis if we choose to fan out jobs.

### 3. What integration tests need at runtime

Global setup ([test/setup/global-integration.ts:L4-L21](test/setup/global-integration.ts#L4-L21)) exits the process with a fixed error message if any of `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` are missing. It also does a health `SELECT id FROM flashcards LIMIT 1` and exits if that errors, then `auth.admin.createUser` for a shared `test@integration.local` (idempotent via `email_exists` handling) and stores `TEST_SUPABASE_USER_ID` on `process.env` for later helpers ([test/helpers/integration-user.ts:L21-L26](test/helpers/integration-user.ts#L21-L26)).

Additional read pins:
- The `astro:env/server` alias ([vitest.config.ts:L5](vitest.config.ts#L5)) maps to [test/setup/astro-env-server.ts](test/setup/astro-env-server.ts#L8-L11), which reads `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` for the SUT (any code under test that imports `astro:env/server`).
- Per-test integration users are minted through the admin client ([test/helpers/integration-user.ts:L43-L78](test/helpers/integration-user.ts#L43-L78)) — every RLS / account-deletion test relies on `TEST_SUPABASE_SERVICE_ROLE_KEY`.
- Cookbook confirmation: [context/foundation/test-plan.md §6.2](context/foundation/test-plan.md) states "Prerequisites: local Supabase running (`npx supabase start`) with `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` exported from the local status output."

**Implication for Phase 4:** Any CI job that runs `npm run test:integration` must first (a) start Supabase locally on the runner, (b) apply migrations from [supabase/migrations](supabase/migrations), and (c) export the three `TEST_SUPABASE_*` env vars.

### 4. Running Supabase inside GitHub Actions

The official pattern is [`supabase/setup-cli`](https://github.com/supabase/setup-cli). Key points captured from its README:

- Composite action, runs on `ubuntu-latest`, `windows-latest`, `macos-latest`. Requires Node.js 20+ (already present after `actions/setup-node@v4` with `node-version: 22`).
- `- uses: supabase/setup-cli@v3` with no `version:` will read `package-lock.json` and install the `supabase` version declared in the repo lockfile (already `^2.23.4` in [package.json](package.json#L83)) — perfect version parity with local dev.
- `supabase db start` runs all migrations against a fresh Postgres, matching what we do locally.
- Exporting env vars in the exact shape our setup expects is a canonical example in the README:
  ```yaml
  - name: Export local Supabase env vars
    run: |
      supabase status -o env \
        --override-name api.url=TEST_SUPABASE_URL \
        --override-name auth.anon_key=TEST_SUPABASE_ANON_KEY \
        --override-name auth.service_role_key=TEST_SUPABASE_SERVICE_ROLE_KEY \
        >> "$GITHUB_ENV"
  ```
- Cost: `supabase db start` on `ubuntu-latest` is dominated by Postgres image pull + boot; empirical range from the CLI's own CI is ~30–90 s per job.

**Implication for Phase 4:** No secrets are needed for integration in CI — local Supabase generates deterministic keys, and `supabase status -o env` publishes them into the runner's env. This keeps the change entirely additive and does not put a service-role key into repo secrets.

### 5. What "required" actually means for a branch

Two GitHub sources confirm:
- [Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule): required status checks are configured on the branch protection rule (Settings → Branches → *Add rule* or edit existing). The workflow file itself does not make anything "required".
- [Branch protection REST API](https://docs.github.com/en/rest/branches/branch-protection): `PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks` with `contexts: ["<check name>", …]` is the API equivalent. Check names are the job names as they appear in the Actions UI.

**Implication for Phase 4:** Merging Phase 4 has two artifacts on different surfaces:
1. **Workflow file** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): add the test job(s) so their check contexts start appearing on PRs. This is what we implement.
2. **Repo branch-protection rule** for `master`: add the new job names to the "Require status checks to pass before merging" list. This is a manual admin action (or a documented `gh api` one-liner) — it lives outside the repo, so the plan must call it out explicitly rather than assume the code change is enough.

The GitHub UI will not surface a new check as available to require until it has run at least once on a branch/PR, so the natural order is: land the workflow change first, let one PR run through, then tick the boxes.

### 6. Interaction with the `deploy` job

Current `deploy` job depends only on `ci` ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Post-Phase-4, `deploy` should also gate on the test suite (there is no point deploying a red build).

Two ways to wire this:
- Keep one job: add `npm run test:unit` and `npm run test:integration` as steps inside `ci`. `deploy: needs: ci` continues to work unchanged. Simplest, but longest pole per push.
- Split jobs (e.g., `lint-build`, `test-unit`, `test-integration`), then `needs: [lint-build, test-unit, test-integration]` on `deploy`. Faster feedback (parallelism), more surface area for required-status configuration.

Prior deployment plan ([context/changes/deployment/deployment-plan.md](context/changes/deployment/deployment-plan.md)) predates Phase 1–3 and does not mention test gates; nothing there constrains Phase 4's choice.

### 7. Historical context (prior changes)

- **CI test wiring was explicitly deferred to Phase 4.** Phase 1's plan states: "Not wiring `npm test` into CI — [test-plan.md §3 Phase 4](context/foundation/test-plan.md) explicitly holds CI enforcement until Phases 1–3 have produced a suite worth enforcing." See [context/changes/testing-ai-generation-critical-path/plan.md](context/changes/testing-ai-generation-critical-path/plan.md).
- **Integration tests already pass locally** across Risks #3, #4, #5, #6, #7. Reference tests: [test/rls/flashcards-cross-user.integration.test.ts](test/rls/flashcards-cross-user.integration.test.ts), [test/api/generate-privacy-and-input.integration.test.ts](test/api/generate-privacy-and-input.integration.test.ts), [test/account-deletion/account-delete.integration.test.ts](test/account-deletion/account-delete.integration.test.ts), [test/review/review.service.integration.test.ts](test/review/review.service.integration.test.ts).
- **Negative space is unchanged.** [context/foundation/test-plan.md §7](context/foundation/test-plan.md) still bans e2e, visual snapshots, AI-native review passes. Phase 4 must not smuggle any of these in via "while we're at it".
- **Lessons register does not currently constrain CI decisions.** [context/foundation/lessons.md](context/foundation/lessons.md) contains one rule about user-scoped tables (already reflected in Phase 3's test guard) and one about Lodash. Neither touches this phase.

### 8. Open trade-offs for `/10x-plan`

These are the choices research surfaces but does not decide:

| Decision | Options | Considerations |
| --- | --- | --- |
| Job layout | (a) single `ci` job runs lint+build+test:unit+test:integration; (b) three jobs (`lint-build`, `test-unit`, `test-integration`); (c) two jobs (`ci` = lint+build+unit, `integration` = Supabase + integration) | Parallelism vs. simplicity; how much time budget we spend on shard latency vs. GH concurrency. Current single-job CI takes seconds; adding integration (~1–2 min with Supabase spin-up) roughly doubles it. Splitting gives faster PR signal on the cheap checks. |
| `deploy` dependency | (a) keep `needs: ci` only; (b) `needs: [ci, test-integration]`; (c) `needs: [lint-build, test-unit, test-integration]` if fully split | Phase 4's stated goal is preventing regressions from landing on master; the deploy path is the last opportunity to catch. Aligning `needs:` with all required checks is the most defensible. |
| Supabase spin-up scope | (a) start Supabase for the whole workflow; (b) start only inside the integration job | (b) is strictly cheaper for the common PR case where lint/build/unit fail early. |
| Where required-status wiring is recorded | (a) manual step documented in the plan and in Phase 4's change.md notes; (b) a `gh api` snippet added to the plan; (c) a `.github` sub-file (e.g., a rulesets JSON) if we ever adopt Rulesets | Repo protection lives outside the workflow file. The plan must call this out — it's the "actually enforced" half of the Phase 4 goal. |
| Concurrency / cache | (a) `concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`; (b) leave as-is | Optional; cheap way to stop stacked PR pushes eating CI minutes. |

None of these are blocking; all are design choices the plan should make explicit.

## Code References

- [.github/workflows/ci.yml](.github/workflows/ci.yml) — current CI workflow; `ci` job (lint+build) and `deploy` job (`needs: ci`, master push only).
- [package.json](package.json#L7-L9) — `test`, `test:unit`, `test:integration` scripts already exist.
- [vitest.config.ts](vitest.config.ts#L18-L45) — two-project workspace (unit / integration); integration wires `globalSetup: ./test/setup/global-integration.ts`.
- [test/setup/global-integration.ts](test/setup/global-integration.ts#L4-L21) — hard-exit if `TEST_SUPABASE_*` env vars missing; seeds shared test user.
- [test/setup/astro-env-server.ts](test/setup/astro-env-server.ts#L8-L11) — SUT-side env reads for the Astro `astro:env/server` alias.
- [test/helpers/integration-user.ts](test/helpers/integration-user.ts#L21-L78) — per-test user creation via service role client.
- [supabase/migrations](supabase/migrations) — migrations that `supabase db start` will apply on the runner.
- [context/foundation/test-plan.md](context/foundation/test-plan.md) — §3 (Phase 4 row), §5 (gates to elevate), §7 (negative space).
- [context/changes/testing-ai-generation-critical-path/plan.md](context/changes/testing-ai-generation-critical-path/plan.md) — the explicit "no CI wiring yet, save for Phase 4" note.
- [context/changes/deployment/deployment-plan.md](context/changes/deployment/deployment-plan.md) — deploy design; predates test phases, does not gate on tests.

## Architecture Insights

- **CI has always been thin by design.** One job, one gate concern, one deploy hop. Phase 4 should preserve that spirit — add test signal, not test infrastructure sprawl.
- **The suite already draws a clean line at the Supabase boundary.** Unit tests are pure; integration tests need a real Postgres. This is exactly the split GitHub Actions rewards: cheap jobs first, heavier jobs behind them with their own service prerequisites.
- **`supabase/setup-cli@v3` + `supabase db start` = production-parity migrations in CI for free.** Because migrations run against a fresh DB every job, we automatically test that migrations are green — a free additional signal we did not have before.
- **The workflow file is only half of "required".** The other half is the repo's branch-protection rule for `master`. Plans that stop at the workflow file leave the gate unenforced. This is the single most common Phase 4 miss.

## Historical Context (from prior changes)

- [context/changes/testing-ai-generation-critical-path/plan.md](context/changes/testing-ai-generation-critical-path/plan.md) — Phase 1 explicitly deferred CI wiring to Phase 4 and named the reason: don't enforce until the suite is worth enforcing.
- [context/changes/testing-rls-cross-user-access/](context/changes/testing-rls-cross-user-access) — Phase 2 built the two-user harness (`invokeApiRoute`, `createIntegrationUser`) that Phase 4 will run in CI without change.
- [context/changes/testing-account-deletion-and-fsrs-wiring/](context/changes/testing-account-deletion-and-fsrs-wiring) — Phase 3 closed the last two integration tests; no further Vitest infra is expected before Phase 4.
- [context/changes/deployment/deployment-plan.md §Phase 4](context/changes/deployment/deployment-plan.md) — set up the current `deploy` job. Landed before test phases; Phase 4 (this change) will layer test gates in front of it.
- [context/archive/2026-06-24-account-deletion-gdpr/plan.md](context/archive/2026-06-24-account-deletion-gdpr/plan.md) — established the service-role-key discipline (`.dev.vars`, `wrangler secret put`). Confirms we do **not** want to add `SUPABASE_SERVICE_ROLE_KEY` to GitHub secrets — local Supabase's ephemeral key is enough for integration tests.

## Related Research

None yet — this is the first research artifact under `testing-quality-gates-wiring/`.

## Open Questions

The following are ready for `/10x-plan` to decide and are not blockers:

1. **Job layout.** One CI job with sequential steps, or split (`lint-build`, `test-unit`, `test-integration`) for parallelism?
2. **`deploy` dependencies.** Should `deploy` gate on the test job(s), or keep `needs: ci` only?
3. **Supabase spin-up placement.** Only inside the integration job (cheapest), or a workflow-wide service (simpler)?
4. **How to record required-status configuration.** In-plan checklist + admin action, `gh api` snippet, or a documented Ruleset?
5. **Whether to add `concurrency:` to the workflow.** Optional; unrelated to Phase 4's core goal but a natural companion tightening.
