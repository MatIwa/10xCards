# CI/CD AI Code Review Workflow — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Ship the repository's first AI code-review pipeline: every PR to `master` is scored 1–10 across 7 criteria (Correctness, Readability, Test coverage, Security, Error handling, Maintainability, Consistency) by the existing `packages/code-reviewer` engine, then annotated with a summary comment and a red/green pass-fail label. The engine already exists; today it outputs the wrong contract and has no CI wiring — this closes that gap.

## Starting Point

`packages/code-reviewer` is a working Node 22 ESM CLI that sends a diff to OpenRouter and returns Zod-validated JSON — but as `{summary, verdict, findings[]}`, not the scoring model. CI is one lean workflow (`ci.yml`) with no `.github/actions/` and zero PR-comment/label automation. `OPENROUTER_API_KEY` is local-dev only, not a GitHub secret.

## Desired End State

Opening/updating a PR runs an advisory `ai-code-review` workflow that acquires the diff, feeds title + description + diff to the reviewer, computes `passed = every(score ≥ 7)` in code, upserts a single marker comment with the 7-score table + summary, and toggles `ai-cr:passed`/`ai-cr:failed`. Adding `ai-cr:review` re-runs it; fork PRs without the secret skip green instead of failing red.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Pass/fail location | In composite action, all 7 criteria ≥ 7 | Policy stays auditable in code, independent of model reliability | Plan |
| PR trigger | `pull_request`, skip when secret absent | Safe by default — no secret exposure to untrusted fork code | Plan |
| Enforcement | Advisory (non-blocking) | Ships the loop without false-positive merge blocks while scoring is new | Plan |
| Run source | `tsx` via `npm run start` (no build) | Fewer steps, matches the package's dev workflow | Plan |
| Output detail | Drop `findings[]` — scores + summary only | Simplest contract, matches requirements exactly | Plan |
| Model inputs | Title + full description + diff | Model judges the change against its stated intent | Plan |
| Comment | Upsert one marker comment | One authoritative comment; retries don't spam the thread | Plan |
| Labels | Workflow ensures `ai-cr:*` idempotently | Self-contained; works on a fresh clone with no manual setup | Plan |

## Scope

**In scope:** 7-criterion schema + prompt rewrite (package), PR title/description inputs + CLI flags, schema unit test, composite action computing pass/fail + comment body, PR-triggered workflow with retry guard, fork/secret skip, diff acquisition, idempotent labels, comment upsert, wiring the `OPENROUTER_API_KEY` secret.

**Out of scope:** Making the check blocking, `pull_request_target`, retaining `findings[]`, the parked business-alignment/architectural-fit criteria, a `dist/` build, model-selection UI, any change to `ci.yml`.

## Architecture / Approach

Three inner-to-outer layers. **(1) Package:** rewrite `reviewOutputSchema` → `{summary, scores(7×int 1–10)}`, add optional `title`/`description` inputs threaded into a rewritten 7-criteria prompt (preserving and extending the `<diff>` untrusted-data boundary to the new PR metadata) and CLI flags. **(2) Composite action** (`.github/actions/ai-code-review/action.yml`): install package deps, run reviewer over title/description/diff, parse JSON, compute pass/fail, render a marker comment body. **(3) Workflow** (`.github/workflows/ai-code-review.yml`): triggers, retry guard, secret skip, diff acquisition, label provisioning/toggling, comment upsert.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rewrite the review contract | Package emits 7 scores + summary; schema test | Extending the injection boundary to untrusted PR title/description |
| 2. Composite action | Reusable action: pass/fail + comment body | Deterministic JSON parsing + threshold logic in bash/JS |
| 3. Workflow + GitHub automation | PR-triggered review, labels, comment, retry | Retry-label guard loops; fork/secret skip must stay green |

**Prerequisites:** Repo-owner adds the `OPENROUTER_API_KEY` GitHub Actions secret; `GITHUB_TOKEN` default permissions suffice for comments/labels.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Test runner for the package-local schema test (root Vitest vs package-local) resolved in Phase 1 — prefer reusing root `vitest` if it can see `packages/code-reviewer/test/**`.
- LLM score stability across identical diffs is unverified; advisory (non-blocking) posture contains the blast radius this iteration.
- Single-owner repo assumption underpins the fork/secret-skip choice; revisit if external contributors need reviews.

## Success Criteria (Summary)

- A PR to `master` shows exactly one AI-review comment (7-score table + summary) and the correct `ai-cr:passed`/`ai-cr:failed` label, updating in place on new commits.
- Adding `ai-cr:review` re-runs the review; adding unrelated labels does not.
- Fork/secret-absent PRs skip cleanly (green), and the existing `ci` workflow is untouched.
