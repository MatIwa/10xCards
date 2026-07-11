# CI Quality-Gates Wiring Implementation Plan

## Overview

Wire the existing Vitest suite into GitHub Actions on every push/PR to `master`: extend the current `ci` job with `npm run test:unit`, add a parallel `integration` job that spins up local Supabase via `supabase/setup-cli@v3` and runs `npm run test:integration`, and gate `deploy` on both. Then register the two check contexts as required on the `master` branch-protection rule via a documented `gh api` command. This closes rollout Phase 4 of [context/foundation/test-plan.md](../../foundation/test-plan.md) — "Quality-gates wiring in CI".

## Current State Analysis

- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) has one `ci` job (checkout → setup-node@22 → `npm ci` → `astro sync` → `npm run lint` → `npm run build`) and one `deploy` job (`needs: ci`, master push only, runs `npx wrangler deploy`). No test step exists yet.
- Vitest is fully wired: [vitest.config.ts](../../../vitest.config.ts#L18-L45) defines `unit` and `integration` projects; [package.json](../../../package.json#L7-L9) exposes `test`, `test:unit`, `test:integration` scripts.
- Integration tests hard-exit if `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` are missing — see [test/setup/global-integration.ts](../../../test/setup/global-integration.ts#L4-L21). Unit tests have no infrastructure requirement.
- `supabase` CLI is already a devDependency (v2.23.4 — [package.json](../../../package.json#L83)); `supabase/setup-cli@v3` reads that version from the lockfile.
- Phases 1–3 have shipped their tests; the suite is currently green locally and covers Risks #1–#7.
- Branch-protection state on `master` is external to this repo; the current required checks (per admin) include lint/build via the existing `ci` context. The new contexts must be added there after they run once.

## Desired End State

Every push and PR to `master` runs `lint → build → test:unit` in one job (`ci`) and `supabase db start → test:integration` in a parallel job (`integration`). Both must be green before `deploy` runs on master push. Both check contexts are listed under "Require status checks to pass before merging" on `master`, so a red suite blocks merge. `.github/workflows/ci.yml` remains the single source of truth for pipeline shape; `change.md` records the one-time `gh api` command that pinned the required-status contexts.

Verify by opening a PR that fails an integration test on purpose → CI shows `integration` red → merge button is blocked. Revert the sabotage → both checks green → deploy runs on merge to master.

### Key Discoveries:

- `supabase/setup-cli@v3` + `supabase db start` applies all migrations from [supabase/migrations](../../../supabase/migrations) to a fresh Postgres on the runner in ~30–90 s. See research §4.
- `supabase status -o env --override-name api.url=TEST_SUPABASE_URL --override-name auth.anon_key=TEST_SUPABASE_ANON_KEY --override-name auth.service_role_key=TEST_SUPABASE_SERVICE_ROLE_KEY >> "$GITHUB_ENV"` publishes the three env vars our global setup expects, no repo secrets needed. Research §4.
- `deploy` in the current workflow uses `SUPABASE_URL` / `SUPABASE_KEY` (production anon keys) as repo secrets — unrelated to `TEST_SUPABASE_*`; do not conflate them. See [.github/workflows/ci.yml](../../../.github/workflows/ci.yml).
- Adding a job's `name:`/`id` to workflow YAML makes it *run*; the branch-protection rule is what makes it *required*. Research §5.
- GitHub only lists a check as "available to require" after it has run at least once on the target branch — so the sequence is: land workflow → let one PR run → then `gh api` to require both contexts.

## What We're NOT Doing

- No e2e (Playwright), no visual-diff, no AI-native review passes. §7 negative-space of [context/foundation/test-plan.md](../../foundation/test-plan.md).
- No refactor of CI into reusable composite actions.
- No Node-version matrix, no coverage upload, no Docker-image caching, no retry/flake mitigation. All out of scope; add later only if signal warrants.
- No addition of `SUPABASE_SERVICE_ROLE_KEY` to repo secrets. Local Supabase's ephemeral key is what integration uses in CI.
- No post-edit hook wiring (Module 3 Lesson 3 territory per [context/foundation/test-plan.md §5](../../foundation/test-plan.md)).
- No changes to pre-commit hooks; lint/format stays with husky + lint-staged locally.

## Implementation Approach

Three phases, additive and independently verifiable:

1. Land the cheap gate first (`test:unit` inside the existing `ci` job) plus a workflow-level `concurrency:` block. One commit, minimal blast radius; if this breaks something, revert is one file.
2. Add the heavy gate as a new `integration` job with Supabase spin-up, and re-point `deploy` to `needs: [ci, integration]`. Both checks now run in parallel; deploy waits for both.
3. Register both contexts as required on `master` via a documented `gh api` command; record the command in `change.md` so re-establishing branch protection later is a one-liner. This phase is entirely outside the repo (branch-protection is a GitHub-side setting) but must ship or the enforcement half of Phase 4 doesn't happen.

## Critical Implementation Details

- **Check context naming** — GitHub's required-status list matches on the job name displayed in the Actions UI. That name comes from the workflow's `jobs.<id>.name:` if set, otherwise from `<id>` itself. Keep the job IDs `ci` and `integration` stable and unnamed (matching current convention) so contexts are `ci` and `integration`; changing them later requires re-editing branch protection.
- **Ordering of new required checks** — GitHub will not surface `integration` as an available required-status until it has run at least once on `master` or a PR branch. The `gh api` step in Phase 3 must run *after* Phase 2's workflow has executed at least one green run; the plan calls this out explicitly.
- **`deploy` sequencing** — `needs: [ci, integration]` means both must be green. If either is red the deploy skips, which is the goal. Do not add `if: success()` — it's implicit and adding it silently changes semantics for `always()` cases.

## Phase 1: Add unit tests + concurrency to `ci` job

### Overview

Extend the existing `ci` job with a `npm run test:unit` step, and add a workflow-level `concurrency:` block so pushes to the same ref cancel prior in-flight runs. The `ci` check context is unchanged in name; the gate simply covers more ground.

### Changes Required:

#### 1. Workflow file — extend `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add `npm run test:unit` as a step in the `ci` job, between `npm run lint` and `npm run build`, so a unit-test regression fails before we pay the build cost. Also add a top-level `concurrency:` block that groups by `github.ref` and cancels in-progress runs so stacked PR pushes stop wasting CI minutes.

**Contract**:
- New top-level key `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` above `jobs:`.
- New step in the `ci` job named `Run unit tests` executing `npm run test:unit`, placed after `npm run lint` and before `npm run build`. No env vars required (unit tests are hermetic).
- No change to `deploy` in this phase.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `npx @action-validator/cli .github/workflows/ci.yml` (or the `actionlint` equivalent) exits 0.
- On a PR containing this change, GitHub Actions shows `ci` job with steps `Checkout → Setup Node → npm ci → astro sync → npm run lint → npm run test:unit → npm run build`, all green.
- Locally `npm run test:unit` completes green (baseline sanity — no regression introduced by ordering).
- Pushing a second commit to the same PR branch cancels the prior in-flight run (visible in the Actions UI as a "cancelled" prior run).

#### Manual Verification:

- Confirm on a real PR that lint failure fails the job before unit tests run (fast-fail preserved).
- Confirm on a real PR that a deliberately broken unit test fails the `ci` job at the `Run unit tests` step.
- Confirm the existing `deploy` job on master push continues to work unchanged (nothing gates on `test:integration` yet).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Add `integration` job with local Supabase

### Overview

Add a new sibling job `integration` that installs the Supabase CLI, brings up local Supabase, exports the three `TEST_SUPABASE_*` env vars, then runs `npm run test:integration`. Update `deploy` to depend on both `ci` and `integration`.

### Changes Required:

#### 1. Workflow file — new `integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a new job `integration` triggered on the same `push` / `pull_request` events as `ci`, running in parallel. It installs the Supabase CLI via the official action, boots local Supabase (which applies all migrations from `supabase/migrations`), exports the three test env vars using `supabase status -o env` with the override flags, then runs `npm run test:integration`.

**Contract**:
- New job id `integration` on `ubuntu-latest`, no `needs:` (runs in parallel with `ci`).
- Steps in order:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version: 22`, `cache: npm`
  3. `npm ci`
  4. `npx astro sync`
  5. `supabase/setup-cli@v3` (no `version:` — reads from lockfile)
  6. `supabase db start` (applies migrations to fresh Postgres)
  7. Named step `Export local Supabase env vars` that runs:
     ```bash
     supabase status -o env \
       --override-name api.url=TEST_SUPABASE_URL \
       --override-name auth.anon_key=TEST_SUPABASE_ANON_KEY \
       --override-name auth.service_role_key=TEST_SUPABASE_SERVICE_ROLE_KEY \
       >> "$GITHUB_ENV"
     ```
     (Snippet included because the `--override-name` syntax is non-obvious and must match the exact env-var names our global setup reads.)
  8. `npm run test:integration`
- No repo secrets referenced. No `deploy`-style env vars on this job.

#### 2. Workflow file — gate `deploy` on both checks

**File**: `.github/workflows/ci.yml`

**Intent**: Change `deploy`'s `needs: ci` to `needs: [ci, integration]` so a red integration run blocks deploy on master push.

**Contract**: Single-line change to the `needs:` key of the `deploy` job. No other changes to `deploy` (secrets, steps, conditional all stay).

### Success Criteria:

#### Automated Verification:

- Workflow YAML remains valid: `actionlint` (or equivalent) exits 0.
- On a PR containing this change, both `ci` and `integration` jobs appear in the Actions UI and run in parallel.
- The `integration` job's `supabase db start` step completes successfully and applies all migrations (visible in step logs — count matches [supabase/migrations](../../../supabase/migrations) file count).
- The `Export local Supabase env vars` step writes the three `TEST_SUPABASE_*` names to `$GITHUB_ENV` (verifiable via a debug echo step during first run, or by the fact that `npm run test:integration` doesn't hit the "missing env" hard-exit path in [test/setup/global-integration.ts](../../../test/setup/global-integration.ts#L4-L21)).
- `npm run test:integration` completes green on CI (matches local behavior).
- After merge to master, `deploy` runs only if both `ci` and `integration` are green.

#### Manual Verification:

- Deliberately break an integration test on a PR branch → `integration` job fails → PR shows red status → merge button is disabled (once Phase 3 lands the required-status wiring).
- Deliberately break a migration on a PR branch → `supabase db start` fails → `integration` fails at that step (bonus signal: migrations are now verified in CI).
- Confirm total `integration` job runtime is in the expected 1.5–3 min range (Supabase boot dominates).
- Confirm `ci` job runtime is unchanged from Phase 1 (integration doesn't slow the fast path).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Register `ci` and `integration` as required status checks

### Overview

Add both check contexts to the `master` branch-protection rule via `gh api`. Record the exact command in `change.md` so the requirement is greppable and reproducible. This phase is a one-time admin action that executes *after* Phases 1 and 2 have run at least one green PR on the repo (GitHub only surfaces contexts after their first appearance).

### Changes Required:

#### 1. `change.md` — record the required-status command

**File**: `context/changes/testing-quality-gates-wiring/change.md`

**Intent**: Under a new `## Follow-up: required-status wiring` heading, document the exact `gh api` command that was run to add the two contexts to `master` protection. Include a note that the command must be re-run if branch protection is ever recreated (e.g., after a fork/reimport).

**Contract**:
- Section heading `## Follow-up: required-status wiring`.
- The command (single call, replaces the contexts list — preserves any pre-existing contexts by including them explicitly; the author must inspect `gh api repos/{owner}/{repo}/branches/master/protection/required_status_checks` first and merge):
  ```bash
  gh api -X PATCH \
    /repos/MatIwa/10xCards/branches/master/protection/required_status_checks \
    -f strict=true \
    -f "contexts[]=ci" \
    -f "contexts[]=integration"
  ```
  (Snippet included because the exact endpoint path, the array-append syntax `contexts[]=`, and the `-X PATCH` flag are all non-obvious for a one-shot admin action.)
- One-sentence note that this command overwrites the contexts array; if any additional contexts already exist on `master` protection they must be added to the same call.

#### 2. Verify the requirement is active

**File**: (no file — verification step)

**Intent**: After running the `gh api` PATCH, open a PR that intentionally fails one integration test and confirm merge is blocked with the message "Required statuses must pass".

**Contract**: Verification observation, not a code artifact. Document the outcome in the Progress section below.

### Success Criteria:

#### Automated Verification:

- `gh api repos/MatIwa/10xCards/branches/master/protection/required_status_checks` returns a body whose `contexts` array contains both `"ci"` and `"integration"`.
- A subsequent PR with a broken integration test shows the "Required statuses must pass before merging" gate on the merge button.

#### Manual Verification:

- A PR with all green checks continues to be mergeable (no false positives).
- After merge to master, `deploy` still runs — required-status wiring did not accidentally block deploy.
- `change.md` contains the runnable `gh api` command under the follow-up heading.

**Implementation Note**: After completing this phase and all automated verification passes, this is the final phase — record completion in `## Progress` and hand off for archive via `/10x-archive`.

---

## Testing Strategy

This change adds test enforcement infrastructure; it does not add new test files. The testing strategy is therefore about verifying the enforcement itself.

### Unit Tests:

- No new unit tests required. The existing `src/**/*.test.ts` files are what get enforced.

### Integration Tests:

- No new integration tests required. The existing `src/**/*.integration.test.{ts,tsx}` and `test/**/*.integration.test.{ts,tsx}` files are what get enforced.

### Manual Testing Steps:

1. Open a PR with the Phase 1 change → observe `ci` job now runs `npm run test:unit`.
2. Push a follow-up commit → confirm the prior run cancels (concurrency wiring).
3. Open a PR with the Phase 2 change → observe `ci` and `integration` jobs run in parallel; both go green.
4. Deliberately break a unit test on a scratch PR → confirm `ci` job fails at `Run unit tests` step.
5. Deliberately break an integration test on a scratch PR → confirm `integration` job fails at `npm run test:integration` step.
6. After Phase 3 runs the `gh api` PATCH, retry step 5 → confirm the PR merge button is blocked with the required-status message.
7. Fix the sabotage → confirm all checks green and merge button re-enables.

## Performance Considerations

- `ci` job runtime grows by `npm run test:unit` duration only — currently well under 10 s locally, expected under 20 s on `ubuntu-latest`.
- `integration` job runtime is dominated by `supabase db start` (~30–90 s Postgres boot + migration apply) + `npm run test:integration` (~30–60 s locally). Expected total: 1.5–3 min per run.
- Because `integration` runs in parallel with `ci`, PR feedback for the fast path (lint/build/unit) is not slowed.
- `concurrency:` cancel-in-progress prevents stacked pushes from double-charging CI minutes.
- No new secrets, no new network egress patterns beyond what Supabase CLI already does (pulls Postgres image from Docker Hub).

## Migration Notes

Not applicable — this change adds CI infrastructure; no data migrations, no schema changes, no runtime behavior changes.

Rollback: revert the `ci.yml` change to the previous commit. The `gh api` PATCH from Phase 3 is separately reversible by re-running the command with the shorter contexts list (or removing `integration` from it).

## References

- Related research: [context/changes/testing-quality-gates-wiring/research.md](research.md)
- Test plan phase row: [context/foundation/test-plan.md §3 row 4](../../foundation/test-plan.md)
- Quality gates matrix: [context/foundation/test-plan.md §5](../../foundation/test-plan.md)
- Negative space: [context/foundation/test-plan.md §7](../../foundation/test-plan.md)
- Current CI: [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
- Vitest config: [vitest.config.ts](../../../vitest.config.ts#L18-L45)
- Integration global setup: [test/setup/global-integration.ts](../../../test/setup/global-integration.ts#L4-L21)
- Prior deferral note: [context/changes/testing-ai-generation-critical-path/plan.md](../testing-ai-generation-critical-path/plan.md)
- Deploy job origin: [context/changes/deployment/deployment-plan.md](../deployment/deployment-plan.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add unit tests + concurrency to `ci` job

#### Automated

- [x] 1.1 Workflow YAML is valid (`actionlint` exits 0) — cf1a89f
- [x] 1.2 PR shows `ci` job running `Checkout → Setup Node → npm ci → astro sync → npm run lint → npm run test:unit → npm run build` all green — cf1a89f
- [x] 1.3 `npm run test:unit` completes green locally — cf1a89f
- [x] 1.4 Follow-up push to same PR branch cancels the prior in-flight run — cf1a89f

#### Manual

- [x] 1.5 Lint failure still fails the job before unit tests run — cf1a89f
- [x] 1.6 A deliberately broken unit test fails `ci` at the `Run unit tests` step — cf1a89f
- [x] 1.7 Existing `deploy` on master push continues to work unchanged — cf1a89f

### Phase 2: Add `integration` job with local Supabase

#### Automated

- [x] 2.1 Workflow YAML remains valid (`actionlint` exits 0) — fefb754
- [x] 2.2 PR shows `ci` and `integration` jobs running in parallel — ecd5dcc
- [x] 2.3 `supabase db start` step completes and applies all migrations — ecd5dcc
- [x] 2.4 `Export local Supabase env vars` step writes three `TEST_SUPABASE_*` names to `$GITHUB_ENV` — ecd5dcc
- [x] 2.5 `npm run test:integration` completes green on CI — ecd5dcc
- [x] 2.6 After master merge, `deploy` runs only if both `ci` and `integration` are green — ecd5dcc

#### Manual

- [ ] 2.7 Deliberately broken integration test fails `integration` job on PR
- [ ] 2.8 Deliberately broken migration fails `supabase db start` step
- [ ] 2.9 `integration` runtime is within expected 1.5–3 min range
- [ ] 2.10 `ci` runtime unchanged from Phase 1

### Phase 3: Register `ci` and `integration` as required status checks

#### Automated

- [ ] 3.1 `gh api repos/MatIwa/10xCards/branches/master/protection/required_status_checks` returns contexts array containing both `"ci"` and `"integration"`
- [ ] 3.2 PR with broken integration test shows "Required statuses must pass before merging" on merge button

#### Manual

- [ ] 3.3 PR with all green checks remains mergeable (no false positive block)
- [ ] 3.4 Master `deploy` continues to run after merge (no accidental block)
- [ ] 3.5 `change.md` contains the runnable `gh api` command under `## Follow-up: required-status wiring`
