## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

- **Correctness** — Whether the change does what it claims and handles edge cases. A 1 means the logic is broken or introduces regressions; a 10 means it is provably correct across normal and boundary inputs.
- **Readability** — How easily another engineer can follow the code. A 1 means cryptic naming and tangled control flow; a 10 means clear names, small functions, and self-evident intent.
- **Test coverage** — Whether the change is backed by meaningful automated tests. A 1 means untested or trivially asserted behavior; a 10 means the critical paths and edge cases are exercised and would catch regressions.
- **Security** — Whether the change avoids introducing vulnerabilities. A 1 means it exposes secrets, trusts unvalidated input, or opens an OWASP-class hole; a 10 means inputs are validated, secrets stay server-side, and least-privilege is respected.
- **Error handling** — How gracefully failures are anticipated and surfaced. A 1 means errors are swallowed or crash the flow; a 10 means failures are caught at boundaries and reported with actionable context.
- **Maintainability** — How well the change fits future evolution without accumulating debt. A 1 means duplication, tight coupling, and hidden assumptions; a 10 means cohesive, loosely coupled code that is easy to extend.
- **Consistency** — Whether the change follows the repository's established conventions. A 1 means it fights the existing style, patterns, and tooling; a 10 means it is indistinguishable from idiomatic project code.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added