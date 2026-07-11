<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI Quality-Gates Wiring

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Scope**: All 3 phases (change complete)
- **Date**: 2026-07-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Env-var export diverges from planned `--override-name` approach [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: .github/workflows/ci.yml:43-53
- **Detail**: Plan §"Phase 2 → Contract → Step 7" specified a single-command export using `supabase status -o env --override-name api.url=... --override-name auth.anon_key=... --override-name auth.service_role_key=... >> "$GITHUB_ENV"`. Actual implementation writes stdout to `/tmp/supa.env`, cats it for debug, then greps three hard-coded keys (API_URL, ANON_KEY, SERVICE_ROLE_KEY). Fix-commits 5852726 and e4ed6b3 ("parse plain-text output", "capture stdout only") show the original approach was tried and abandoned, but the plan was never amended.
- **Fix**: Append a plan addendum recording that `--override-name` did not produce the expected env-file shape with the CLI version in the `supabase/setup-cli@v3` action, and that the grep/extract fallback is the accepted contract going forward.
  - Strength: Updates source-of-truth so future reviewers don't re-open a resolved question. Keeps working code intact.
  - Tradeoff: Plan diverges from its own "critical implementation details" bullet — future readers must consult both.
  - Confidence: HIGH — commit trail makes the reason for divergence self-evident.
  - Blind spot: Whether a newer supabase CLI version would restore the cleaner approach; not tested here.
- **Decision**: FIXED — plan addendum A1 appended documenting the `--override-name` fallback (2026-07-11).

### F2 — `supabase start` used instead of planned `supabase db start` [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .github/workflows/ci.yml:41
- **Detail**: Plan Phase 2 Step 6 specifies `supabase db start` (Postgres-only). Actual command is `supabase start` (full stack — DB + Auth + PostgREST + Storage). Commit 8f0cd9f ("use supabase start instead of db start") made the switch without a plan update. The full stack is almost certainly required — integration tests use `SERVICE_ROLE_KEY` against the Auth API when creating test users, which `db start` alone does not boot.
- **Fix**: Update plan Phase 2 to say `supabase start` and note the reason (integration tests exercise Auth endpoints, not just Postgres).
- **Decision**: FIXED — Phase 2 Contract Step 6 updated with rationale; Progress checkboxes 2.3 and 2.8 aligned (2026-07-11).

### F3 — `gh api PUT /protection` replaces whole object; plan specified targeted PATCH [FIXED via Fix A]

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-quality-gates-wiring/change.md:29-45
- **Detail**: Plan Phase 3 documented a PATCH on the sub-resource `/branches/master/protection/required_status_checks` with just the contexts array. Recorded command in `change.md` is a PUT on the full parent resource `/branches/master/protection` with a JSON body that also sets `enforce_admins: false`, `dismiss_stale_reviews: false`, `required_pull_request_reviews: null`, `restrictions: null`. This overwrites the entire protection object — if any of those settings were previously configured differently, they were silently reset. For a solo repo with no prior settings the outcome is the same, but the recorded command is the wrong tool for re-establishing protection later (e.g., after adding required reviewers).
- **Fix A ⭐ Recommended**: Replace the recorded PUT with the plan's targeted PATCH on `/required_status_checks`, so re-running never clobbers other protection settings.
  - Strength: Matches the plan's intent; safe to re-run at any time regardless of what other branch-protection settings exist. Aligns with the plan's stated rationale for using PATCH.
  - Tradeoff: The PUT-form command captures the full current state, which is arguably a nicer "recreate from scratch" recipe. Losing that requires future readers to inspect the current protection object first.
  - Confidence: HIGH — plan explicitly called out this concern ("preserves any pre-existing contexts by including them explicitly").
  - Blind spot: Whether GitHub's PATCH endpoint accepts an empty `contexts[]` array (edge case not tested).
- **Fix B**: Leave PUT as-is, add a warning line above it explaining that re-running overwrites unrelated protection settings.
  - Strength: Preserves the "full-state" recipe; documents its danger.
  - Tradeoff: Doesn't fix the plan-vs-actual gap — future reviewers will keep raising it.
  - Confidence: MEDIUM — depends on whether "recreate from scratch" vs "additive PATCH" is the intended UX.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `change.md` follow-up rewritten to use the targeted `PATCH /required_status_checks` recipe; historical `PUT` noted (2026-07-11).

### F4 — Stray `test-branch-protection.txt` left in repo root [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: test-branch-protection.txt
- **Detail**: Single-line file "Test commit for branch protection verification" added on branch `test/verify-branch-protection` (PR #18) to exercise the required-status gate. Merged to master (commit e3c9a9d) and never removed. Not mentioned in the plan or in `change.md`.
- **Fix**: Delete the file and commit as `chore: remove branch-protection verification artifact`.
- **Decision**: FIXED — file removed from working tree (staged deletion); user to commit as `chore: remove branch-protection verification artifact` (2026-07-11).

### F5 — Unrelated `.gitignore` course-material entries bundled into CI-gates work [ACCEPTED-AS-RULE]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore:31-35
- **Detail**: Commit 9d16612 ("untrack 10xDevs course materials and add to .gitignore") added `.github/skills/`, `.agents/skills/`, and `skills-lock.json` to `.gitignore` during the CI-gates change window. Legitimate hygiene, but out of scope for a plan whose "What We're NOT Doing" bounds are all about CI shape. A follow-up change or separate small PR would have kept this change atomic.
- **Fix**: Accept as-is (change is small and already merged); note in `lessons.md` a rule about not bundling ambient hygiene commits into scoped change PRs.
- **Decision**: ACCEPTED-AS-RULE: "Do not bundle ambient hygiene commits into a scoped change PR" appended to `context/foundation/lessons.md` (2026-07-11). Existing `.gitignore` edit left in place.

### F6 — Debug `cat /tmp/supa.env` prints ephemeral Supabase keys to job log [FIXED]

- **Severity**: 📎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:44-47
- **Detail**: The `Export local Supabase env vars` step echoes the full contents of `/tmp/supa.env` (including `ANON_KEY` and `SERVICE_ROLE_KEY`) plus a "Sanity: TEST_SUPABASE_URL=…" line. These are ephemeral local Supabase keys valid only for the runner's lifetime, so this is not a real secret leak. Worth cleaning up now that things work so the pattern doesn't get copy-pasted into a place where the values do matter.
- **Fix**: Remove the debug echoes and the `cat /tmp/supa.env` block (leave the `extract` logic intact).
- **Decision**: FIXED — `cat /tmp/supa.env`, the surrounding `---` banners, and the `Sanity: TEST_SUPABASE_URL=…` echo removed from `.github/workflows/ci.yml`; `extract` logic retained (2026-07-11).
