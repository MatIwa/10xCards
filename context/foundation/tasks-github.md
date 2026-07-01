# GitHub Issues — Roadmap Migration

Created: 2026-05-31
Updated: 2026-07-01
Repository: MatIwa/10xCards

## Labels

| Label | Color | Purpose |
|---|---|---|
| `foundation` | #5319e7 | Horizontal enabler / infrastructure work |
| `slice` | #0e8a16 | Vertical user-facing slice |
| `stream:A` | #1d76db | Core review loop |
| `stream:B` | #e99695 | AI differentiator |
| `stream:C` | #d93f0b | Compliance |
| `stream:D` | #c2e0c6 | UX polish |

## Issues

| Roadmap ID | Issue | Title | Labels | Prerequisites | State |
|---|---|---|---|---|---|
| F-01 | #1 | Flashcard table with SR metadata + RLS | foundation, stream:A, stream:B | — | CLOSED |
| S-01 | #2 | Manual flashcard CRUD (create, view, edit, delete) | slice, stream:A | #1 | CLOSED |
| S-02 | #3 | Spaced repetition review session | slice, stream:A | #1, #2 | CLOSED |
| S-03 | #4 | AI flashcard generation from pasted text | slice, stream:B | #1 | CLOSED |
| S-04 | #5 | Account deletion with full data erasure (GDPR) | slice, stream:C | #1 | CLOSED |
| S-05 | #6 | UX improvements (bulk candidate actions, review reset, loading states) | slice, stream:D | #1 | CLOSED |

## Test Plan Rollout Issues

| Roadmap ID | Issue | Title | Labels | Prerequisites | State |
|---|---|---|---|---|---|
| TP-00 | #17 | Track phased test rollout | foundation | #13, #14, #15, #16 | OPEN |
| TP-01 | #13 | Bootstrap Vitest runner and AI generation critical-path tests | foundation, stream:B | — | CLOSED |
| TP-02 | #14 | Add server-boundary contract tests | foundation, stream:B, stream:C | #13 | OPEN |
| TP-03 | #15 | Add account deletion and FSRS wiring tests | foundation, stream:A, stream:C | #13 | OPEN |
| TP-04 | #16 | Wire test suite into CI | foundation | #14, #15 | OPEN |

Duplicate setup issues #9, #10, #11, and #12 were closed; #13-#17 are canonical.

## Dependency Graph

```
F-01 (#1)
├── S-01 (#2)
│   └── S-02 (#3)  ← North Star
├── S-03 (#4)
├── S-04 (#5)
└── S-05 (#6)
```
