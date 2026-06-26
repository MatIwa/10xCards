<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Deletion (GDPR)

- **Plan**: context/changes/account-deletion-gdpr/plan.md
- **Scope**: All phases (1 & 2)
- **Date**: 2026-06-26
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Notes

- Drift sweep: every planned file matches its contract. No EXTRA files outside the plan. No MISSING items.
- Load-bearing checks pass: `user_id` is sourced exclusively from session (`context.locals.user.id`), service-role key is imported only in `src/lib/supabase-admin.ts` and only from server code, the orphan-check inline comment is present verbatim, and the dual-client construction + destructive-flow ordering in `src/pages/api/account/delete.ts` matches the plan snippet.
- Lessons rule "user-scoped tables must cascade + be orphan-checked" is honored — `flashcards` is currently the only user-scoped table per `supabase/migrations/`.
- Automated checks: `npx astro check` → 0 errors / 0 warnings / 5 hints; `npm run lint` → 0 errors / 2 warnings (see F3); `npm run build` → success.

## Findings

### F1 — Service return shape diverges from `{data, error}` convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/account.service.ts:3-6
- **Detail**: `deleteAccount` returns `{ deletedFlashcards: number; error: string | null }`. Every other service in the repo (see `src/lib/services/flashcard.service.ts:5-12`) returns `{ data: T | null; error: string | null }` via the `DataResult<T>` shape. Call site at `src/pages/api/account/delete.ts:36` destructures the custom field, so the refactor is one-call wide.
- **Fix**: Switch to `Promise<DataResult<number>>` and return `{ data: deletedFlashcards, error: null }`; update the single destructure at `src/pages/api/account/delete.ts:36` to `const { data: deletedFlashcards, error } = ...`.
- **Decision**: FIXED

### F2 — Success-criterion grep matches in `dist/server/` (security intent still holds)

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/account-deletion-gdpr/plan.md:188 (Phase 1 automated check 1.4)
- **Detail**: The criterion reads `grep -r "SUPABASE_SERVICE_ROLE_KEY" dist/ after build returns no matches`. After a fresh build, the key name appears in 3 files under `dist/server/` (the delete handler chunk, the Layout/config-status chunk, and the server bundle) plus the copied `.dev.vars`. `dist/client/` has 0 matches — the **security intent** (no client-bundle leakage) is fully satisfied; only the literal criterion as written is too broad to pass.
- **Fix**: Narrow the success criterion in any future addendum/template to `grep -r "SUPABASE_SERVICE_ROLE_KEY" dist/client/` returns no matches.
- **Decision**: FIXED

### F3 — Two `no-console` lint warnings on plan-mandated structured logs

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/account/delete.ts:38, src/pages/api/account/delete.ts:42
- **Detail**: `npm run lint` exits 0 but emits two `no-console` warnings on the `console.error("account_delete_failed", ...)` and `console.log(JSON.stringify({ event: "account_deleted", ... }))` calls. Both calls were explicitly required by the plan (Phase 1, Changes Required §7) as the audit-log mechanism. The repo's ESLint rule treats `console` as a warning, not an error, so the build remains green.
- **Fix**: Add a scoped `// eslint-disable-next-line no-console` on both lines with a one-line comment referencing the GDPR audit requirement so future contributors don't strip the calls.
- **Decision**: FIXED
