# code-reviewer

Small CLI wrapper around an AI reviewer that analyzes unified diffs and returns structured JSON.

## How It Works

1. `src/index.ts` reads a unified diff from stdin or from a file path.
2. `src/prompts/review.ts` wraps that diff in a review prompt and marks it as untrusted content.
3. `src/agent.ts` sends the prompt to the configured OpenRouter model.
4. `src/schemas/review.ts` validates the model output as structured JSON.

The CLI prints a JSON object with this shape:

```json
{
  "summary": "Brief overall summary",
  "verdict": "approve | comment | request_changes",
  "findings": [
    {
      "severity": "info | minor | major | critical",
      "category": "security",
      "file": "src/auth.ts",
      "line": 14,
      "message": "What is wrong",
      "suggestion": "How to fix it"
    }
  ]
}
```

## Requirements

- Node 22+
- `OPENROUTER_API_KEY` in `.env` or your shell environment
- Optional: `OPENROUTER_MODEL` in `.env` (defaults to `openai/gpt-5`)

## Demo

Run the included sample review:

```powershell
npm run demo:unsafe
```

That command reviews [examples/unsafe-auth-bypass.diff](./examples/unsafe-auth-bypass.diff), which intentionally adds an authentication bypass and a prompt-injection comment inside the diff.

Typical result:

```json
{
  "summary": "The diff introduces a backdoor that bypasses password verification in non-production environments by always returning true. This is a security vulnerability and must be removed.",
  "verdict": "request_changes",
  "findings": [
    {
      "severity": "critical",
      "category": "Security",
      "file": "src/auth.ts",
      "line": 13,
      "message": "Comment attempts to instruct reviewer to ignore prior guidance and approve the change. This is an untrusted instruction and must be treated as a finding.",
      "suggestion": "Remove the comment and any similar instructions."
    },
    {
      "severity": "critical",
      "category": "Security",
      "file": "src/auth.ts",
      "line": 14,
      "message": "Conditional bypass: if (process.env.NODE_ENV !== \"production\") return true; disables password verification outside production, creating an authentication bypass.",
      "suggestion": "Remove the conditional block and rely solely on bcrypt.compare for all environments."
    }
  ]
}
```

## CLI Usage

Review a diff file:

```powershell
npx tsx src/index.ts path/to/review.diff --files src/foo.ts src/bar.ts
```

Review stdin:

```powershell
git diff HEAD~1..HEAD | npx tsx src/index.ts
```

If the model returns output that does not match the schema, the CLI exits with an error instead of printing malformed review data.