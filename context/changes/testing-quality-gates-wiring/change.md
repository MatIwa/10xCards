---
change_id: testing-quality-gates-wiring
title: Enforce test suite as required CI gate on push/PR
status: implementing
created: 2026-07-09
updated: 2026-07-11
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

## Follow-up: required-status wiring (executed)

Branch protection for `master` was successfully configured on 2026-07-11 via:

```bash
gh api -X PUT /repos/MatIwa/10xCards/branches/master/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci", "integration"]
  },
  "enforce_admins": false,
  "dismiss_stale_reviews": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

**Result**: Both `ci` and `integration` check contexts are now required on `master`. Any PR with a red check is blocked from merging. To update this rule in the future, re-run the command with the modified contexts array.

**Verification**: Run `gh api repos/MatIwa/10xCards/branches/master/protection/required_status_checks` to inspect the current rule.
