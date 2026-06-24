<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account Deletion (GDPR)

- **Plan**: [context/changes/account-deletion-gdpr/plan.md](../plan.md)
- **Mode**: Deep
- **Date**: 2026-06-24
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, key symbols (`createClient`, `auth.admin.deleteUser`, `Banner` variants, `ON DELETE CASCADE`, `PROTECTED_API_PREFIXES`) ✓, brief↔plan ✓.

## Findings

### F1 — `signOut()` after admin delete has no failure handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §7 (deletion endpoint snippet); §Critical Implementation Details
- **Detail**: Plan calls `await userSupabase.auth.signOut()` *after* `auth.admin.deleteUser(userId)`. By default `signOut()` runs with `scope: 'global'` and POSTs to Supabase's `/auth/v1/logout` to revoke the refresh token server-side. With the underlying user row already gone, that server call may return 401/404. The plan's snippet has no try/catch, no scope override, and no fallback cookie clear. Two realistic failure modes: (a) supabase-js returns `{ error }` silently — endpoint then 303s but the auth cookie may not have been cleared, producing the exact "stale-cookie flash" the plan claims to prevent; (b) supabase-js throws — endpoint returns 500 even though the account was successfully deleted, so the user never sees the `?deleted=1` banner. The plan's own claim that signOut "still clears the browser cookie deterministically" is untested. Existing precedent `src/pages/api/auth/signout.ts` also ignores the return value, but that code path runs on a *valid* session — this one doesn't.
- **Fix A ⭐ Recommended**: Use `signOut({ scope: 'local' })` and ignore errors.
  - Strength: Local scope is a pure cookie clear via the SSR adapter — no server round-trip, no dependency on a now-defunct session. Matches the actual intent (clear browser cookies; the auth row is already gone server-side).
  - Tradeoff: None significant; we already lost the server session by deleting the user.
  - Confidence: HIGH — `scope: 'local'` is the documented choice for "clear client state only" in supabase-js.
  - Blind spot: None significant.
- **Fix B**: Wrap in try/catch and explicitly delete supabase cookies via `context.cookies.delete()` on failure.
  - Strength: Defensive belt-and-suspenders; works even if a future supabase-js change breaks `scope: 'local'`.
  - Tradeoff: Requires hard-coding the Supabase cookie names (e.g. `sb-<project-ref>-auth-token`), which couples the endpoint to Supabase's internal naming.
  - Confidence: MEDIUM — cookie names are stable but not contract.
  - Blind spot: Project-ref-derived cookie name in tests/local vs. prod.
- **Decision**: Fixed via Fix A

### F2 — Orphan verification is hard-coded to `flashcards`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §6 (account.service.ts contract); plan-brief.md §Open Risks
- **Detail**: The plan's verification step queries only `public.flashcards`. The brief itself flags this as a risk ("Future authenticated routes might persist user-scoped data... new tables must declare ON DELETE CASCADE on user_id → auth.users(id)"), but the plan ships no enforcement mechanism. Roadmap S-04 sits in Stream C alongside Streams A/B that will land new user-scoped tables (generation history, preferences, etc.). As soon as any of those land without a matching CASCADE *and* without updating this verification, the endpoint silently certifies "complete erasure" while orphan rows persist — a GDPR contract break the runtime check is supposed to prevent.
- **Fix ⭐ Recommended**: Capture the rule in `context/foundation/lessons.md` and pin it via a comment in the service file.
  - Add to `lessons.md`: a new rule "Every user-scoped table must cascade on auth.users delete and be added to the orphan-check" with `Applies to: plan, implement, impl-review, plan-review` and a rule stating that when adding any table with `user_id` referencing `auth.users(id)`, the migration must declare `on delete cascade` AND `src/lib/services/account.service.ts` must be extended to query the new table in the orphan-check.
  - Add an inline comment in `account.service.ts` next to the `flashcards` verification: `// TABLES: extend this check when adding any new user-scoped table — see lessons.md`.
  - Strength: Cheap (two text edits) and surfaces in the exact place a future developer would need to remember. `/10x-plan` and `/10x-impl-review` re-read `lessons.md` on every run.
  - Tradeoff: Relies on contributor discipline; no compile-time guard.
  - Confidence: HIGH — the lessons.md mechanism already exists and is consumed by the workflow.
  - Blind spot: A migration that adds a table outside the agent flow still goes unchecked.
- **Decision**: Fixed via Fix ⭐

### F3 — Banner variant for the `?deleted=1` notice is left unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §6 (Post-delete banner on sign-in)
- **Detail**: Plan says "Render a `<Banner variant="success">` (or equivalent existing variant)" and explicitly forbids adding a new variant in this phase. Actual `Banner.astro` accepts only `"info" | "warning" | "error"` — there is no `"success"`. The implementer is left to pick, and the wording invites guessing. The existing `<Banner variant="error">` in Layout.astro for missingConfigs will visually clash with whatever is chosen for the "deletion succeeded" notice if both render on the same page.
- **Fix**: Pick `variant="info"` deterministically. Update Phase 2 §6 to: `Render a <Banner variant="info"> with copy "Your account and all your data have been permanently deleted." Adding a real "success" variant is out of scope for this slice.`
- **Decision**: Fixed via Fix

### F4 — Pre-count select transports every row id instead of using `count: 'exact'`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §6 (account.service.ts, Step 1)
- **Detail**: Step 1 says "`select id from public.flashcards where user_id = $userId` via admin client; capture the count". This transports one UUID per card just to compute `.length`. A power user with thousands of cards pays for that.
- **Fix**: Use `await adminClient.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", userId)` and read `response.count`. `head: true` skips the body entirely.
- **Decision**: Fixed via Fix

### F5 — Cascade reference line citation is off

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: §References — "Cascade declaration"
- **Detail**: Plan cites `create_flashcards.sql line 8`. The actual cascade declaration is on line 13 (`user_id uuid not null references auth.users(id) on delete cascade`).
- **Fix**: Update the reference to "line 13".
- **Decision**: Fixed via Fix
