# Verification Note — Modular Code Review Agent (ToolLoopAgent)

Reproducible evidence for the manual success criteria in `plan.md` (items 2.4, 2.5, 3.5).
Added during implementation review to close finding F3 (missing reproducible evidence).

- **Date**: 2026-08-05
- **Package**: `packages/code-reviewer`
- **Default model**: `OPENROUTER_MODEL` → `openai/gpt-5` (see `src/config.ts`)
- **Provider**: OpenRouter (`OPENROUTER_API_KEY` required; value redacted, never logged)

## Reproducible checks (re-run this review)

Run from `packages/code-reviewer/`:

```
npm run typecheck    # tsc --noEmit — passed
npm run build        # tsc -p tsconfig.json — passed
```

### 3.5 — CLI error paths (no live model, deterministic)

```
"" | node dist/index.js            # empty stdin
# → prints USAGE to stderr, exit=1

node dist/index.js ./does-not-exist.diff   # missing file
# → prints "Failed to read diff input." to stderr, exit=1 (sanitized; no stack trace / absolute path)
```

Both confirmed on 2026-08-05.

## Live-model checks (require OPENROUTER_API_KEY)

Items 2.4, 2.5, and the happy-path half of 3.5 call the live provider and are not
captured deterministically in the repo. To reproduce and record output shape
(redact the diff/keys, keep only structure):

```
# 3.5 happy path — structured review for a sample diff
node dist/index.js path/to/sample.diff
# → stdout is JSON matching ReviewOutput: { verdict, summary, findings[] }

# 2.5 — standalone reviewer with .generate() callable directly
node -e "import('./dist/agent.js').then(async ({ createReviewer }) => { const r = createReviewer(); const out = await r.generate({ diff: '...'}); console.log(Object.keys(out.output)); })"
```

Expected output shape (verifiable from `src/schemas/review.ts` without a live call):
`ReviewOutput = { verdict: 'approve'|'comment'|'request_changes', summary: string, findings: Array<{ severity, ... }> }`.

Record the redacted command, model ID, date, and exit status here when a live run is performed.
