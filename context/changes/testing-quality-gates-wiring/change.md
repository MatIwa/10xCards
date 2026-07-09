---
change_id: testing-quality-gates-wiring
title: Enforce test suite as required CI gate on push/PR
status: planned
created: 2026-07-09
updated: 2026-07-09
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Quality-gates wiring in CI".
Goal: Enforce the suite as a required CI check on push/PR — only meaningful now that phases 1–3 have produced a suite worth enforcing.
Risks covered: cross-cutting (locks the floor under Risks #1–#7 by preventing regressions from landing on master).
Test types planned: gates (CI-required unit + integration jobs, plus post-Phase-4 required-status wiring per §5).

Risk response intent (from test-plan.md §5 Quality Gates):
- Elevate `unit + integration (npm test)` from "required after §3 Phase 4" to actually enforced on push/PR.
- Elevate `server-boundary integration` from "required after §3 Phase 4" to actually enforced on push/PR.
- Preserve existing lint + build gates (already wired in .github/workflows/ci.yml) — do not regress them.
- Respect §7 negative-space: no e2e, no visual-diff, no AI-native gates added here.

After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
