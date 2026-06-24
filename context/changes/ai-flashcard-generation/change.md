---
change_id: ai-flashcard-generation
title: AI flashcard generation from pasted text
status: impl_reviewed
created: 2026-06-23
updated: 2026-06-24
archived_at: null
---

## Notes

Roadmap slice **S-03** (`context/foundation/roadmap.md`) — Stream B, the AI differentiator. Parallel with Stream A; only prerequisite (F-01: flashcard schema with SR metadata) is already CLOSED.

GitHub issue: **#4** (`context/foundation/tasks-github.md`) — labels: `slice`, `stream:B`; state: OPEN.

**Outcome:** user can paste source text, trigger AI flashcard generation, review a list of AI-generated proposals, and accept, edit, or reject each card individually — with accepted cards saved to their collection immediately.

**PRD refs:** US-01, FR-004, FR-005, FR-006.

**Open questions to resolve during planning:**
- Source text input boundaries (min/max char count) — roadmap open question #1.
- LLM provider integration (OpenRouter per PRD) — latency/cost risk.
- Privacy NFR: source text must NOT be retained after generation completes — hard rule in `AGENTS.md`.

**Implementation notes (post-plan):**
- Phase 1: shipped with `liquid/lfm-2.5-1.2b-instruct:free` instead of the planned `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. Reason: the planned model proved unreliable on the OpenRouter free tier during manual smoke testing; the liquid model returns valid JSON-mode output with `usage.cost: 0` and was verified against manual checks 1.5 / 2.4 / 3.7. See the addendum at the bottom of `plan.md`.
