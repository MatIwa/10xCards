# GitHub Issues — Roadmap Migration

Created: 2026-05-31
Repository: MatIwa/10xCards

## Labels

| Label | Color | Purpose |
|---|---|---|
| `foundation` | #5319e7 | Horizontal enabler / infrastructure work |
| `slice` | #0e8a16 | Vertical user-facing slice |
| `stream:A` | #1d76db | Core review loop |
| `stream:B` | #e99695 | AI differentiator |

## Issues

| Roadmap ID | Issue | Title | Labels | Prerequisites |
|---|---|---|---|---|
| F-01 | #1 | Flashcard table with SR metadata + RLS | foundation, stream:A, stream:B | — |
| S-01 | #2 | Manual flashcard CRUD (create, view, edit, delete) | slice, stream:A | #1 |
| S-02 | #3 | Spaced repetition review session | slice, stream:A | #1, #2 |
| S-03 | #4 | AI flashcard generation from pasted text | slice, stream:B | #1 |

## Dependency Graph

```
F-01 (#1)
├── S-01 (#2)
│   └── S-02 (#3)  ← North Star
└── S-03 (#4)
```
