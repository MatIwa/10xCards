---
date: 2026-08-05T00:00:00Z
researcher: GitHub Copilot
git_commit: d8af5c6c9559948a1ac77da2e367c29cf9fdfb36
branch: master
repository: MatIwa/10xCards
topic: "CI/CD AI code review workflow built on packages/code-reviewer"
tags: [research, codebase, ci-cd, github-actions, code-reviewer, openrouter]
status: complete
last_updated: 2026-08-05
last_updated_by: GitHub Copilot
---

# Research: CI/CD AI code review workflow built on `packages/code-reviewer`

**Date**: 2026-08-05T00:00:00Z
**Researcher**: GitHub Copilot
**Git Commit**: d8af5c6c9559948a1ac77da2e367c29cf9fdfb36
**Branch**: master
**Repository**: MatIwa/10xCards

## Research Question

Per [context/changes/ci-cd-code-review/requirements.md](../../changes/ci-cd-code-review/requirements.md): build the first GitHub Actions workflow for agentic code review on every PR to `master`, wrapping the review logic in a composite action. Inputs are the PR title, PR description, and git diff. Each PR is scored 1–10 across seven criteria (Correctness, Readability, Test coverage, Security, Error handling, Maintainability, Consistency). Side effects: a PR summary comment and a red/green label (`ai-cr:failed` / `ai-cr:passed`), with on-demand retry when the `ai-cr:review` label is added. This research maps the existing `packages/code-reviewer` package, the current CI conventions, the GitHub-automation gap, and the schema gap between the package's current output and the required 7-criterion scoring model.

## Summary

- **The engine exists but outputs the wrong shape.** [packages/code-reviewer](../../../packages/code-reviewer) is a standalone Node 22 ESM CLI that reads a unified diff (stdin or file), sends it to an OpenRouter model via an `ai` SDK `ToolLoopAgent`, and prints structured JSON validated by Zod. Its current schema is `{ summary, verdict(approve|comment|request_changes), findings[] }` — **not** the 7-criterion 1–10 scoring model the requirements demand. A schema + prompt rewrite is required; the agent/config/CLI plumbing can stay.
- **The CI foundation is minimal and well-conventioned.** There is exactly one workflow, [.github/workflows/ci.yml](../../../.github/workflows/ci.yml), with three jobs (`ci`, `integration`, `deploy`), Node 22 + npm cache, a `concurrency` cancel-stale block, and job names that double as branch-protection check contexts. No composite actions exist yet, and no PR-comment or label automation exists anywhere in the repo.
- **Two net-new capability areas.** (1) A composite action under `.github/actions/**` invoking the reviewer, and (2) GitHub write-side automation (PR comment + label toggling) — neither has any precedent in this repo, so both are greenfield.
- **`OPENROUTER_API_KEY` is not wired into CI.** The package needs it; it exists only for local dev. A new GitHub secret must be added, which raises a fork/`pull_request_target` security consideration (see Architecture Insights).
- **No tests exist for the package.** Nothing asserts on its output schema, so the schema change carries no test-breakage cost — but adding schema tests is advisable.

## Detailed Findings

### `packages/code-reviewer` — the review engine

**Shape & runtime.** Standalone package, `"type": "module"`, `"main": "./dist/index.js"`, `engines.node >= 22` ([packages/code-reviewer/package.json](../../../packages/code-reviewer/package.json)). It has its own `node_modules/` and `package-lock.json` and is **not** part of a root npm workspace (root [package.json](../../../package.json) has no `workspaces` field). Scripts:

- `dev` / `start` → `tsx src/index.ts`
- `build` → `tsc -p tsconfig.json` (emits JS + `.d.ts` to `dist/`)
- `demo:unsafe` → runs the reviewer against `examples/unsafe-auth-bypass.diff`
- `typecheck` → `tsc --noEmit`

`tsconfig.json`: `module: NodeNext`, `target: ES2022`, `outDir: dist`, `rootDir: src`, `strict: true`, `declaration: true`.

**Entry / CLI.** [packages/code-reviewer/src/index.ts](../../../packages/code-reviewer/src/index.ts) reads a diff from a file arg or stdin, supports a `--files <path> ...` flag for extra context, and writes pretty JSON to stdout. Error paths (empty diff, bad args, model failure) write to stderr and set exit code 1. Direct-run detection uses `import.meta.url` comparison (Node 22 has no `import.meta.main`).

**Agent.** [packages/code-reviewer/src/agent.ts](../../../packages/code-reviewer/src/agent.ts#L23-L41): `reviewDiff()` parses input with `reviewInputSchema`, builds the prompt, and calls a `ToolLoopAgent` (`ai` SDK) with `Output.object({ schema: reviewOutputSchema })`. It retries up to `MAX_REVIEW_ATTEMPTS = 3` on any error and re-throws the last error otherwise. Output is re-validated with `reviewOutputSchema.parse(...)`.

**Config / env.** [packages/code-reviewer/src/config.ts](../../../packages/code-reviewer/src/config.ts): calls `process.loadEnvFile()` (swallows missing `.env`), then validates env with Zod — `OPENROUTER_API_KEY` (required) and `OPENROUTER_MODEL` (default `openai/gpt-5`). Creates the OpenRouter client via `@openrouter/ai-sdk-provider`.

**Prompt & injection defense (already solid).** [packages/code-reviewer/src/prompts/review.ts](../../../packages/code-reviewer/src/prompts/review.ts): the system prompt establishes a security boundary — the diff is wrapped in `<diff>…</diff>` delimiters and marked UNTRUSTED, with an explicit instruction never to obey instructions inside the diff and to surface injection attempts as findings instead. This prompt-injection posture should be preserved verbatim when the prompt is rewritten for scoring.

**How to run it in CI (dev mode, no build):**
```bash
cd packages/code-reviewer
npm ci
git diff origin/master...HEAD | npm run start   # JSON review to stdout
# env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL (optional)
```

### Existing CI conventions

Only [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) exists. Established patterns to mirror:

- Triggers: `push` and `pull_request` to `master`; `concurrency` group `ci-${{ github.ref }}` with `cancel-in-progress: true`.
- Runner `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 22` + `cache: npm`, then `npm ci` and `npx astro sync`.
- Job IDs are stable and act as required check contexts (`ci`, `integration`) — renaming breaks branch protection.
- `deploy` gates on `needs: [ci, integration]` and only runs on push to `master`.
- Secrets used today: `SUPABASE_URL`, `SUPABASE_KEY` (build), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (deploy). Integration tests use ephemeral local Supabase (`supabase status -o env`), no GitHub secrets.

**Reusable root scripts** ([package.json](../../../package.json)): `lint`, `test:unit`, `test:integration`, `test:e2e`, `build`.

### The GitHub-automation gap (greenfield)

- **No `.github/actions/` directory** — the requested composite action has no precedent.
- **No PR comment or label automation** anywhere. No `actions/github-script`, no `peter-evans/*`, no `gh pr comment`/`gh api` inside a workflow. The only `gh` usage in the repo is a documented **manual** branch-protection command in [context/archive/2026-07-09-testing-quality-gates-wiring/change.md](../../archive/2026-07-09-testing-quality-gates-wiring/change.md) (`gh api -X PATCH …/branches/master/protection/required_status_checks`).
- Implication: the workflow must introduce (a) diff acquisition (`checkout` with `fetch-depth: 0`, then `git diff origin/master...HEAD`, or `gh pr diff`), (b) a comment step, and (c) label toggling — all new. Both `github-script` and `gh` CLI are viable; `gh` is already a documented team tool.

### The scoring-model gap (schema rewrite)

Current output ([packages/code-reviewer/src/schemas/review.ts](../../../packages/code-reviewer/src/schemas/review.ts)) vs required:

| Aspect | Current | Required |
| --- | --- | --- |
| Decision | `verdict` enum `approve\|comment\|request_changes` | binary pass/fail → labels `ai-cr:passed` / `ai-cr:failed` |
| Scoring | per-finding `severity` (`info\|minor\|major\|critical`) | 7 criteria, each integer 1–10 |
| Detail | `findings[]` (`category`, `file?`, `line?`, `message`, `suggestion?`) | not required; summary explains scores |
| Summary | `summary` string | `summary` string (kept) |

Minimal changes to produce the required model:

- **[schemas/review.ts](../../../packages/code-reviewer/src/schemas/review.ts)** — add a `reviewScoresSchema` object with 7 `z.number().int().min(1).max(10)` fields (correctness, readability, testCoverage, security, errorHandling, maintainability, consistency); replace `reviewOutputSchema` with `{ summary, scores, passed }` (or keep `findings[]` as optional detail). Input schema (`diff` + `filePaths`) is unchanged. Note: the requirements add PR **title** and **description** as inputs — these are new fields on `reviewInputSchema` (and `buildReviewPrompt`) if they should reach the model.
- **[prompts/review.ts](../../../packages/code-reviewer/src/prompts/review.ts)** — rewrite `REVIEW_SYSTEM_PROMPT` to define the 7 criteria (copy the 1-vs-10 definitions from requirements.md), request one score per criterion, and state the pass threshold. **Preserve** the existing `<diff>` untrusted-data boundary.
- **[agent.ts](../../../packages/code-reviewer/src/agent.ts)** / **[config.ts](../../../packages/code-reviewer/src/config.ts)** — no changes; they already consume `reviewOutputSchema` and env generically.

**Pass/fail decision — where it should live** (open decision, see Open Questions):
- *Option A (prompt-guided):* the model emits `passed: boolean` per a threshold baked into the prompt. Simple; threshold change requires a prompt edit.
- *Option B (post-processing):* the model emits only scores; a wrapper/workflow computes `passed = every(score >= threshold)`. More flexible/configurable; adds a small deterministic step outside the LLM. **Option B is generally preferable** because pass/fail is a policy decision that shouldn't depend on model reliability, and it keeps the threshold auditable in code.

### Tests

No tests exist for the package (`packages/code-reviewer/**` has none; `test/packages/**` is empty). The schema change breaks nothing, but adding a schema-validation unit test (score bounds, `passed` boolean, injection-attempt-as-finding behavior) is low-cost insurance.

## Code References

- `packages/code-reviewer/src/index.ts` — CLI: stdin/file diff input, `--files` flag, JSON stdout, exit-code error handling
- `packages/code-reviewer/src/agent.ts:23-41` — `reviewDiff()`, `ToolLoopAgent`, `Output.object(reviewOutputSchema)`, 3-retry loop
- `packages/code-reviewer/src/config.ts` — `OPENROUTER_API_KEY` (required) / `OPENROUTER_MODEL` (default `openai/gpt-5`), `process.loadEnvFile()`
- `packages/code-reviewer/src/prompts/review.ts` — system prompt + `<diff>` untrusted-data boundary (prompt-injection defense)
- `packages/code-reviewer/src/schemas/review.ts` — current `verdict`/`findings` output schema (to be replaced with 7-criterion scores)
- `packages/code-reviewer/package.json` — standalone package, Node 22 ESM, `build`/`dev`/`start` scripts
- `.github/workflows/ci.yml` — the only workflow; `ci`/`integration`/`deploy` jobs, Node 22, npm cache, concurrency, secret usage
- `package.json` — reusable `lint`/`test:*`/`build` scripts and OpenRouter dependency

## Architecture Insights

- **Reuse the engine, replace the contract.** The agent, config, retry, CLI, and injection defense are reusable as-is. Only the Zod schema + prompt (the "review contract") must change to the 7-criterion model. Keep the injection boundary intact.
- **Composite action as the seam.** Wrapping "install deps → run reviewer → parse JSON → set outputs" in `.github/actions/ai-code-review/action.yml` keeps the top-level workflow declarative (matches the repo's clean, minimal `ci.yml` style) and isolates the Node/OpenRouter mechanics.
- **Job-name-as-check-context convention.** If this review should ever be a required/blocking check, its job ID becomes a branch-protection context (per the archived quality-gates change). Pick a stable job ID up front.
- **Fork / `pull_request_target` security tension.** `pull_request` runs from forks get a read-only token and **no secrets**, so `OPENROUTER_API_KEY` would be unavailable — the review would fail on external PRs. `pull_request_target` exposes secrets but runs the **base** ref's workflow against untrusted PR code, the classic secret-exfiltration risk. For a single-owner repo this is low-risk, but the plan must choose deliberately. The package's in-diff prompt-injection defense mitigates *content* attacks but not *workflow* secret exposure.
- **Least-privilege permissions.** The workflow needs explicit `permissions:` — at minimum `pull-requests: write` (comment) and `issues: write` (labels), `contents: read`. Default `GITHUB_TOKEN` can post comments and manage labels; no PAT required.
- **Retry-on-label trigger.** The `ai-cr:review` retry implies `on: pull_request: types: [opened, synchronize, reopened, labeled]` plus a guard so the job only runs when the added label is `ai-cr:review` (or on the normal PR events), otherwise every label add re-runs the reviewer.
- **Label toggling is stateful.** Passing must add `ai-cr:passed` and remove `ai-cr:failed` (and vice versa); labels must pre-exist in the repo (color red/green) or be created idempotently. Comments should ideally be updated in place (find-existing-by-marker) rather than appended on each re-run.

## Historical Context (from prior changes)

- [context/archive/2026-07-09-testing-quality-gates-wiring/plan.md](../../archive/2026-07-09-testing-quality-gates-wiring/plan.md) — rationale for the two-parallel-job CI shape and the "job IDs are stable check contexts; renaming re-breaks branch protection" convention.
- [context/archive/2026-07-09-testing-quality-gates-wiring/change.md](../../archive/2026-07-09-testing-quality-gates-wiring/change.md) — the manual `gh api PATCH` branch-protection command; the only `gh`/GitHub-API precedent in the repo.
- [context/changes/deployment/deployment-plan.md](../../changes/deployment/deployment-plan.md) — Phase 4 CI/CD wiring: `deploy` job depends on `ci`, uses secrets, targets `.github/workflows/ci.yml`.
- [context/archive/2026-07-12-sentry-monitoring/plan.md](../../archive/2026-07-12-sentry-monitoring/plan.md) — "Not touching CI"; confirms CI has stayed intentionally lean.
- [context/foundation/lessons.md](../../foundation/lessons.md) — relevant priors: keep ambient hygiene out of scoped PRs (`chore:` separately); no Lodash / prefer native APIs — both apply when implementing the reviewer changes.

## Related Research

- [context/architect-report.md](../../architect-report.md) — repo-level architecture overview (broader context).
- No prior `research.md` exists for a CI/code-review topic; this is the first.

## Open Questions

1. **Pass/fail threshold & location.** What threshold defines "passed" (e.g., all criteria ≥ 7, or a weighted/average score)? And is it computed in the prompt (Option A) or in code/workflow (Option B, recommended)?
2. **Keep `findings[]`?** Retain per-finding file/line detail alongside the 7 scores, or fold detail into the `summary`? Affects schema and comment formatting.
3. **PR description as input — cost vs. signal.** requirements.md flags this as a cost tradeoff. Include title only, or title + full body? Large bodies increase token cost.
4. **Fork PRs / secret exposure.** `pull_request` (no secrets on forks, review fails) vs `pull_request_target` (secrets available, base-ref execution). Which trigger, given the repo is currently single-owner?
5. **Blocking vs advisory.** Should `ai-cr:failed` block merge (added as a required check / branch-protection context) or remain informational?
6. **Comment idempotency.** Update a single marker comment on re-runs, or post a fresh comment each time?
7. **Run source: `tsx` vs built `dist/`.** Run via `npm run start` (tsx, no build) for simplicity, or `npm run build` + `node dist/index.js` for a production artifact?
8. **Label bootstrap.** Are `ai-cr:passed` / `ai-cr:failed` / `ai-cr:review` created manually once, or ensured idempotently by the workflow?
