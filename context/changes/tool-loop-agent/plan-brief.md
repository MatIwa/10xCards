# Modular Code Review Agent (ToolLoopAgent) — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Convert `packages/code-reviewer/src/index.ts` from a single-file ADK starter (unused `@google/adk` `LlmAgent` + a one-shot `generateText`) into a well-organized, modular **code review agent** built on the AI SDK's `ToolLoopAgent`. Schemas and prompts move into their own modules, and the agent is exported through a small reusable surface so a future promptfoo eval harness can drive it.

## Starting Point

Today `index.ts` mixes Zod env parsing, an ADK `LlmAgent` that's never used for review, and an OpenRouter-backed `generateText` starter. There are no tools, no structured output schema, and no review-specific prompt. The package is ESM + strict TS, runs via `tsx`, and re-exports from `src/index.ts`.

## Desired End State

The package exposes `createReviewer()` (a configured `ToolLoopAgent` with structured output) and `reviewDiff({ diff, filePaths? })` (returns a validated `{ summary, verdict, findings[] }`). Code is split into `config.ts`, `schemas/review.ts`, `prompts/review.ts`, `agent.ts`, and a slim `index.ts` CLI. `@google/adk` is gone; typecheck, build, and lint pass.

## Key Decisions Made

| Decision                | Choice                                              | Why (1 sentence)                                                        | Source |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Agent tool surface      | No tools — single-pass structured output            | Deterministic, easiest to eval; ToolLoopAgent lets tools be added later | Plan   |
| Review input            | Unified diff string (+ optional file paths)         | Matches real review use and clean promptfoo test cases                  | Plan   |
| Output schema           | `summary` + `verdict` + `findings[]` (typed enums)  | Rich enough for real reviews and field-level eval assertions            | Plan   |
| `@google/adk` dependency | Drop entirely (deps + `adk:*` scripts)             | Unused after conversion; matches "no unused libraries" lesson           | Plan   |
| Model provider          | Keep OpenRouter, env-configurable model             | No new setup; preserves existing auth, minimal churn                    | Plan   |
| Export surface          | `createReviewer` factory + thin `reviewDiff` helper | promptfoo can import the agent or the helper; clean, testable seam      | Plan   |

## Scope

**In scope:** module decomposition (config/schemas/prompts/agent/index); `ToolLoopAgent` with `Output.object`; reusable exports; CLI that reviews a diff; removing `@google/adk`.

**Out of scope:** promptfoo/eval config; agent tools; provider switch; git-diff tooling; unit tests; anything outside `packages/code-reviewer/`.

## Architecture / Approach

Bottom-up decomposition. Leaf modules first — `config.ts` (env + OpenRouter client), `schemas/review.ts` (Zod input/output + inferred types), `prompts/review.ts` (system instructions + prompt builder). Then `agent.ts` composes them into a `ToolLoopAgent` (`instructions`, `tools: {}`, `output: Output.object({ schema })`) exposed via `createReviewer` + `reviewDiff`. Finally `index.ts` becomes the public barrel + a stdin-driven CLI, and the ADK dependency is pruned. Build stays green at each phase.

## Phases at a Glance

| Phase                          | What it delivers                                        | Key risk                                             |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| 1. Config + extracted modules  | `config.ts`, `schemas/review.ts`, `prompts/review.ts`   | Schema/enum shape must be eval-friendly              |
| 2. Reusable agent module       | `agent.ts`: `createReviewer` + `reviewDiff`             | Correct `Output.object` wiring + typed `result.output` |
| 3. Rewire entry + drop ADK     | Slim `index.ts` CLI; remove `@google/adk` + scripts     | Removing deps without breaking build/lock            |

**Prerequisites:** `OPENROUTER_API_KEY` available for manual end-to-end checks; `ai@7.0.52` already installed.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes `ToolLoopAgent` with `tools: {}` + `Output.object` reliably returns structured output in a single pass (verified against the installed type defs; confirm at runtime in Phase 2).
- Assumes no external consumers import `createRootAgent` / `generateStarterResponse` (none in-repo today).
- Model quality of findings depends on the configured OpenRouter model; not tuned in this change.

## Success Criteria (Summary)

- Importing `createReviewer` / `reviewDiff` yields a typed, structured code review from a diff.
- CLI reviews a diff from stdin and prints structured findings; empty input exits non-zero.
- `@google/adk` is fully removed; typecheck, build, and repo lint all pass.
