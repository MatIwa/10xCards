# Modular Code Review Agent (ToolLoopAgent) Implementation Plan

## Overview

Convert `packages/code-reviewer/src/index.ts` — today a single file mixing Zod env parsing, an unused `@google/adk` `LlmAgent`, and a one-shot `generateText` starter — into a well-organized, modular **code review agent** built on the AI SDK's `ToolLoopAgent`. The reviewer takes a unified diff (plus optional file paths for context) and returns a structured review (summary, verdict, findings array). Structured-output schemas and prompts live in their own modules, and the agent is exported through a small reusable surface (`createReviewer` factory + `reviewDiff` helper) so that a future promptfoo eval harness can drive it. This change does **not** set up the eval environment.

## Current State Analysis

- `packages/code-reviewer/src/index.ts` currently exports: `envSchema`/`promptSchema` (Zod), `readEnv`, `createOpenRouterClient`, `createRootAgent` (returns `@google/adk` `LlmAgent`), `generateStarterResponse` (one-shot `generateText`), and a CLI `main()`. The ADK agent is constructed but never used for any review flow.
- Provider wiring uses `@openrouter/ai-sdk-provider` `createOpenRouter({ apiKey })`; model id comes from `OPENROUTER_MODEL` (default `openai/gpt-5`), key from `OPENROUTER_API_KEY`.
- `package.json` declares `@google/adk` + `@google/adk-devtools` deps and `adk:run` / `adk:web` scripts, none of which are needed after this conversion.
- The package is ESM (`"type": "module"`), NodeNext module resolution, strict TypeScript, `tsx` for dev/start, and re-exports its public API from `src/index.ts` (`"main": "./dist/index.js"`).

### Key Discoveries:

- `ToolLoopAgent` is available in the installed `ai@7.0.52` and is the intended agent abstraction: `new ToolLoopAgent({ model, instructions, tools?, output? })` with `.generate({ prompt })` / `.stream(...)` (`node_modules/ai/dist/index.d.ts:5141`).
- Structured output is provided via the exported `Output` namespace: `Output.object({ schema })` where `schema` is a Zod/FlexibleSchema, returning an `Output<OBJECT, DeepPartial<OBJECT>>` (`node_modules/ai/dist/index.d.ts:3773`, `:3690`). Pass it as the agent's `output` setting.
- The typed structured result is read from `result.output` on the value returned by `.generate()` (`GenerateTextResult.output` — `node_modules/ai/dist/index.d.ts:4471`). A `ToolLoopAgent` with `tools: {}` and an `output` is a valid single-pass structured reviewer (no tool loop iterations needed).
- `ToolLoopAgent`, `Output`, and `tool` are all exported from `ai` (`node_modules/ai/dist/index.d.ts:9182`).
- Lessons: avoid unused dependencies (drop `@google/adk`); keep the change scoped — no ambient hygiene churn beyond what this change requires (`context/foundation/lessons.md`).

## Desired End State

`packages/code-reviewer/src/` is organized as focused modules:

```
src/
  config.ts            # env schema (Zod) + readEnv + OpenRouter client factory
  schemas/review.ts    # reviewInputSchema + reviewOutputSchema (findings/summary/verdict) + inferred types
  prompts/review.ts    # REVIEW_SYSTEM_PROMPT + buildReviewPrompt(input)
  agent.ts             # createReviewer(overrides?) -> ToolLoopAgent ; reviewDiff(input, overrides?) -> ReviewOutput
  index.ts             # re-exports public API + CLI main() that reviews a diff
```

Verification of the end state:

- `createReviewer()` returns a `ToolLoopAgent` configured with the OpenRouter model, review instructions, no tools, and `Output.object({ schema: reviewOutputSchema })`.
- `reviewDiff({ diff, filePaths? })` calls the agent and returns a validated `ReviewOutput` (`{ summary, verdict, findings[] }`).
- `@google/adk` and `@google/adk-devtools` no longer appear in `package.json`; `adk:*` scripts are gone.
- `npm run typecheck`, `npm run build`, and repo `npm run lint` all pass.
- The CLI reviews a diff supplied on stdin (or via a file-path arg) and prints the structured findings.

## What We're NOT Doing

- Not configuring promptfoo or any eval environment / eval config files (explicitly out of scope — only making the agent importable and reusable for that future work).
- Not adding tools to the agent (the reviewer is single-pass structured output; the `ToolLoopAgent` is used so tools can be added later without an API change).
- Not switching model providers (staying on OpenRouter, env-configurable).
- Not adding a `git diff` / filesystem tool or shelling out.
- Not adding unit tests in this change (test wiring is a separate concern).
- Not touching anything outside `packages/code-reviewer/`.

## Implementation Approach

Decompose by concern, bottom-up: first the leaf modules that carry no dependency on the agent (config, schemas, prompts), then the agent module that composes them, then rewire the entry point and prune the ADK dependency last so the build stays green at each step. Keep the OpenRouter provider wiring intact but move it into `config.ts`. The review output schema is a Zod object with a `findings` array and enum-typed `severity` / `category` / `verdict` fields so promptfoo assertions can target concrete fields. Prompts are plain module constants/functions (no template engine).

## Phase 1: Config + Extracted Modules

### Overview

Create the three leaf modules — provider/env config, review schemas, and review prompts — without yet wiring them into an agent. After this phase the package still builds and the old `index.ts` still works (we edit `index.ts` in Phase 3).

### Changes Required:

#### 1. Config module

**File**: `packages/code-reviewer/src/config.ts`

**Intent**: Move env parsing and OpenRouter client creation out of `index.ts` into a dedicated config module, so the agent and CLI both consume one source of truth. Drop the ADK-specific env fields (`ADK_AGENT_*`).

**Contract**: Export `envSchema` (Zod: `OPENROUTER_API_KEY` required, `OPENROUTER_MODEL` default `openai/gpt-5`), `type AppEnv = z.infer<typeof envSchema>`, `readEnv(source?)`, and `createOpenRouterClient(overrides?)` returning `{ env, openrouter }` (via `createOpenRouter({ apiKey })`). Preserve the existing `process.loadEnvFile()` best-effort behavior.

#### 2. Review schemas module

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Define the reviewer's input contract and the structured review output, as standalone Zod schemas that both the agent (`Output.object`) and future promptfoo assertions can import.

**Contract**: Export `reviewInputSchema` = `{ diff: string (min 1), filePaths?: string[] }` and `reviewOutputSchema` = `{ summary: string, verdict: enum('approve','comment','request_changes'), findings: Array<{ severity: enum('info','minor','major','critical'), category: string, file?: string, line?: number, message: string, suggestion?: string }> }`. Also export inferred types `ReviewInput`, `ReviewOutput`, `ReviewFinding`, and the enum value arrays (e.g. `SEVERITIES`, `VERDICTS`) for reuse. Add short `.describe(...)` annotations on fields to guide the model.

#### 3. Review prompts module

**File**: `packages/code-reviewer/src/prompts/review.ts`

**Intent**: Hold the system instructions and the user-prompt builder so prompt text is versioned separately from agent wiring and easy to iterate on during evals.

**Contract**: Export `REVIEW_SYSTEM_PROMPT` (string instructions describing the reviewer's role, how to use severities/verdict, and to ground findings in the diff) and `buildReviewPrompt(input: ReviewInput): string` that formats the diff and optional `filePaths` into the user message.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (in `packages/code-reviewer`)
- Build passes: `npm run build` (in `packages/code-reviewer`)
- New files exist: `src/config.ts`, `src/schemas/review.ts`, `src/prompts/review.ts`

#### Manual Verification:

- Schema field names/enums read sensibly for a code review and are promptfoo-assertable.
- System prompt reflects the intended reviewer behavior (diff-grounded, structured).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase. Phase blocks use plain bullets — the `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: Reusable Agent Module

### Overview

Compose the Phase 1 modules into a `ToolLoopAgent` behind a factory, plus a thin run helper that returns the parsed structured output. This is the reusable seam promptfoo will import.

### Changes Required:

#### 1. Agent module

**File**: `packages/code-reviewer/src/agent.ts`

**Intent**: Provide `createReviewer` (returns a configured `ToolLoopAgent`) and `reviewDiff` (runs the agent and returns validated `ReviewOutput`), composing `config.ts`, `schemas/review.ts`, and `prompts/review.ts`.

**Contract**: `createReviewer(overrides?: Partial<AppEnv>) => ToolLoopAgent` built with `{ model: openrouter(env.OPENROUTER_MODEL), instructions: REVIEW_SYSTEM_PROMPT, tools: {}, output: Output.object({ schema: reviewOutputSchema }) }`. `reviewDiff(input: ReviewInput | string, overrides?) => Promise<ReviewOutput>` parses input via `reviewInputSchema` (string treated as `{ diff }`), calls `agent.generate({ prompt: buildReviewPrompt(parsed) })`, and returns `result.output` (validated against `reviewOutputSchema`). Import `ToolLoopAgent` and `Output` from `ai`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Build passes: `npm run build`
- `result.output` is typed as `ReviewOutput` (no `any` / casts needed)

#### Manual Verification:

- Running `reviewDiff` against a small sample diff (with a valid `OPENROUTER_API_KEY`) returns a well-formed `ReviewOutput` with at least one finding for an obviously flawed diff.
- `createReviewer` can be imported standalone and its `.generate()` called directly (the shape a promptfoo harness would use).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 3: Rewire Entry + Drop ADK

### Overview

Slim `index.ts` down to the public re-export surface plus a diff-reviewing CLI, and remove the now-unused `@google/adk` dependency and scripts.

### Changes Required:

#### 1. Package entry / public API

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Make `index.ts` the package's public barrel (re-export config, schemas, prompts, and agent API) and replace the old ADK/`generateStarterResponse` CLI with a `main()` that reviews a diff.

**Contract**: Re-export the public API from `./config`, `./schemas/review`, `./prompts/review`, `./agent`. `main()` reads a unified diff from stdin (or a file path passed as argv) plus optional file-path args, calls `reviewDiff`, and writes the structured result (JSON or a formatted summary) to stdout; on empty input, print usage to stderr and set a non-zero exit code. Keep the existing `import.meta.url === pathToFileURL(process.argv[1])` direct-run guard. Remove `createRootAgent` and `generateStarterResponse`.

#### 2. Dependency + script cleanup

**File**: `packages/code-reviewer/package.json`

**Intent**: Remove the unused ADK dependency footprint now that `LlmAgent` is gone.

**Contract**: Delete `@google/adk` from `dependencies`, `@google/adk-devtools` from `devDependencies`, and the `adk:run` / `adk:web` scripts. Run the package's install to refresh `package-lock.json`. Leave `ai`, `@openrouter/ai-sdk-provider`, `zod`, `tsx`, `typescript`, `@types/node` intact.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Build passes: `npm run build`
- Repo lint passes: `npm run lint` (from repo root)
- No references to `@google/adk` remain: grep finds none in `packages/code-reviewer/src` or `package.json`

#### Manual Verification:

- CLI: piping a sample diff into `npm run dev` prints a structured review; empty input prints usage and exits non-zero.
- `package-lock.json` no longer resolves `@google/adk*`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Out of scope for this change (no test harness added). The schemas and `reviewDiff` are structured so a future promptfoo eval / unit test can assert on `ReviewOutput` fields.

### Integration Tests:

- Manual only in this change: exercise `reviewDiff` end-to-end against the live OpenRouter model with a sample diff.

### Manual Testing Steps:

1. With `OPENROUTER_API_KEY` set in `.env`, run the CLI with a small diff that contains an obvious bug; confirm a `critical`/`major` finding and a `request_changes` verdict.
2. Run the CLI with a clean, trivial diff; confirm an `approve` or `comment` verdict with few/no findings.
3. Import `createReviewer` in a scratch script and call `.generate({ prompt })` directly; confirm `result.output` matches `reviewOutputSchema`.
4. Confirm empty stdin prints usage and exits non-zero.

## Performance Considerations

Single LLM call per review (no tool loop). Latency and cost are bounded by the chosen OpenRouter model and diff size; no in-process performance concerns.

## Migration Notes

Consumers importing `createRootAgent` or `generateStarterResponse` from this package will break — both are removed. No such consumers exist in the repo today (the package is standalone). Env var changes: `ADK_AGENT_*` are no longer read.

## References

- Change identity: `context/changes/tool-loop-agent/change.md`
- AI SDK skill: `packages/code-reviewer/.agents/skills/ai-sdk/SKILL.md`
- `ToolLoopAgent` / `Output` API: `packages/code-reviewer/node_modules/ai/dist/index.d.ts:5141`, `:3773`, `:4471`
- Current implementation: `packages/code-reviewer/src/index.ts`
- Lessons: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Config + Extracted Modules

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 5baf965
- [x] 1.2 Build passes: `npm run build` — 5baf965
- [x] 1.3 New files exist: `src/config.ts`, `src/schemas/review.ts`, `src/prompts/review.ts` — 5baf965

#### Manual

- [x] 1.4 Schema field names/enums read sensibly and are promptfoo-assertable — 5baf965
- [x] 1.5 System prompt reflects intended diff-grounded, structured behavior — 5baf965

### Phase 2: Reusable Agent Module

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 788fbf4
- [x] 2.2 Build passes: `npm run build` — 788fbf4
- [x] 2.3 `result.output` is typed as `ReviewOutput` (no `any` / casts) — 788fbf4

#### Manual

- [x] 2.4 `reviewDiff` returns a well-formed `ReviewOutput` for a flawed sample diff
- [x] 2.5 `createReviewer` importable standalone with `.generate()` callable directly

### Phase 3: Rewire Entry + Drop ADK

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Build passes: `npm run build`
- [x] 3.3 Repo lint passes: `npm run lint`
- [x] 3.4 No `@google/adk` references remain in `src` or `package.json`

#### Manual

- [x] 3.5 CLI prints a structured review for a sample diff; empty input exits non-zero
- [x] 3.6 `package-lock.json` no longer resolves `@google/adk*`
