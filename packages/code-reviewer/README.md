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
  "summary": "Brief overall summary of the diff quality",
  "scores": {
    "correctness": 8,
    "readability": 9,
    "testCoverage": 6,
    "security": 3,
    "errorHandling": 7,
    "maintainability": 8,
    "consistency": 9
  }
}
```

Each score is an integer from 1 to 10.

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
  "scores": {
    "correctness": 4,
    "readability": 7,
    "testCoverage": 3,
    "security": 1,
    "errorHandling": 5,
    "maintainability": 6,
    "consistency": 7
  }
}
```

## CLI Usage

Review a diff file:

```powershell
npx tsx src/index.ts path/to/review.diff --files src/foo.ts src/bar.ts
```

Pass pull request metadata for extra context:

```powershell
npx tsx src/index.ts path/to/review.diff --title "Add auth guard" --description "Closes #123"
```

Review stdin:

```powershell
git diff HEAD~1..HEAD | npx tsx src/index.ts
```

If the model returns output that does not match the schema, the CLI exits with an error instead of printing malformed review data.