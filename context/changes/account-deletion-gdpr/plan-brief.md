# Account Deletion (GDPR) — Plan Brief

> Full plan: [context/changes/account-deletion-gdpr/plan.md](plan.md)

## What & Why

Let a logged-in user permanently and irreversibly delete their account from inside the app — wiping their `auth.users` row, all owned flashcards, and their session — to satisfy the GDPR Article 17 right to erasure (PRD §FR-014). EU users must have a self-service path; a manual "email support" workflow does not meet the requirement.

## Starting Point

`auth` and flashcard data already exist with a `flashcards.user_id → auth.users(id) ON DELETE CASCADE` constraint, so a single auth-row delete cascades everything. What's missing is the privilege boundary to call `auth.admin.deleteUser`, a settings UI surface, and the confirmation/sign-out flow. No `/dashboard/settings` page, no service-role key wired, no dialog primitive installed.

## Desired End State

A logged-in user navigates to `/dashboard/settings`, sees a Danger Zone card with their live flashcard count, opens the delete dialog, types `DELETE` to enable the destructive button, and confirms. The server erases the auth row, verifies no orphans remain, logs an audit event, signs them out, and lands the browser on `/auth/signin?deleted=1` with a banner confirming permanent erasure.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Deletion mechanism | Service-role admin client in a dedicated server endpoint | Standard Supabase pattern, explicit privilege boundary, easy to audit; the admin client lives in one importable module so the service-role key has one provable import site. | Plan |
| Entry-point location | Dedicated `/dashboard/settings` page with a Danger Zone card | Standard SaaS placement; keeps the destructive action off the primary working surface and leaves room for future preferences. | Plan |
| Confirmation UX | Typed `DELETE` keyword + visible card count + user email | Industry-standard friction for irreversible actions; affirms identity without the SSO-fragility of password re-auth. | Plan |
| Post-delete UX | 303 redirect to `/auth/signin?deleted=1` with a one-time banner | Closes the loop with explicit confirmation; reuses the existing `?error=` URL-param pattern and the existing `Banner.astro` component. | Plan |
| Cascade trust | Trust `ON DELETE CASCADE` + verify with a follow-up `select … limit 1` on the admin client | Treats the schema as the source of truth, but proves orphan-freedom before reporting success — meets GDPR's "complete erasure" contract. | Plan |
| Partial-failure handling | Fail closed — return 500, keep the user signed in, log server-side | Atomic outcome: account is either fully gone or untouched; failure path should be effectively unreachable in normal operation. | Plan |
| Audit trail | Structured single-line `console.log` of the deletion event into Cloudflare observability | Zero new infra; preserves a record of the irreversible action; can be upgraded to a Postgres audit table later. | Plan |
| Session handling | Endpoint explicitly calls `signOut()` after admin delete and 303-redirects | Deterministic cookie clear avoids a stale-cookie flash on the next navigation; one round trip instead of client-side cleanup. | Plan |

## Scope

**In scope:**
- New env var `SUPABASE_SERVICE_ROLE_KEY` declared as a server-only secret in `astro.config.mjs` and `.env.example`
- New admin Supabase client helper (`src/lib/supabase-admin.ts`)
- New Zod schema, service, and `POST /api/account/delete` endpoint
- `/api/account` added to middleware's JSON-protected prefixes
- New `/dashboard/settings.astro` page with Danger Zone card
- New `DeleteAccountDialog.tsx` React island with typed-confirmation UX
- `npx shadcn@latest add dialog` for the modal primitive
- Topbar + Dashboard "Settings" entry points
- Post-delete confirmation banner on `/auth/signin?deleted=1`
- `config-status` entry surfacing a missing-service-role-key banner

**Out of scope:**
- Soft delete / undo grace period (PRD chose immediate, irreversible)
- Password re-authentication step (deferred until SSO arrives)
- Pre-deletion data export (separate GDPR Article 20 concern)
- Persistent `audit_log` table (deferred until an audit framework exists)
- Broader settings surface beyond the Danger Zone

## Architecture / Approach

```
[ /dashboard/settings.astro ] --(island)--> [ DeleteAccountDialog (typed 'DELETE') ]
                                                          |
                                                          | fetch POST { confirmation: "DELETE" }
                                                          v
                              [ POST /api/account/delete ] -- builds two clients --
                                  |                                              |
                                  | user-scoped anon (cookies)                   | admin (service-role)
                                  v                                              v
                          [ supabase.auth.signOut() ]              [ account.service.ts ]
                                                                   1. count flashcards
                                                                   2. auth.admin.deleteUser
                                                                   3. ON DELETE CASCADE wipes flashcards
                                                                   4. verify count=0
                                  +-- console.log audit event --+
                                  v
                       303 redirect → /auth/signin?deleted=1 → Banner "deleted"
```

Two Supabase clients in the endpoint is the load-bearing structural choice: the anon client owns the user's cookies (so it can sign them out), and the admin client owns the destructive privilege (so it can delete `auth.users` and read across RLS for verification). They never mix.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend — admin client + deletion endpoint | End-to-end deletion contract callable via `POST /api/account/delete`; admin client wired; middleware protects `/api/account`; audit log emitted. | Service-role key accidentally bundled into client code — mitigated by `access: "secret"` + single-import-site admin client module + a build-output grep check in the success criteria. |
| 2. Frontend — settings page + confirmation UX | `/dashboard/settings` page, typed-confirmation dialog with live card count, Topbar/Dashboard entry, post-delete banner on `/auth/signin?deleted=1`. | Typed-confirmation gate accidentally bypassable (e.g., disabled button enabled by HTML manipulation) — mitigated by server-side Zod check on `confirmation: "DELETE"`. |

**Prerequisites:** F-01 (`flashcard-schema-with-sr`) merged with `ON DELETE CASCADE` intact (verified in the migration); access to Supabase service-role key for `.dev.vars` and `npx wrangler secret put` in production.

**Estimated effort:** ~1–2 implementation sessions across the 2 phases.

## Open Risks & Assumptions

- **Assumption**: `auth.users.id` cascade behavior survives all future schema migrations. Mitigation: the post-delete verification count check is the runtime guard that catches any silent regression.
- **Risk**: Production deployment must provision `SUPABASE_SERVICE_ROLE_KEY` via `npx wrangler secret put` before users can use the feature. Without it, the endpoint returns 500 and the existing `config-status` banner warns users. Captured in "Migration Notes".
- **Risk**: Future authenticated routes (e.g., AI generation logs) might persist user-scoped data that this slice doesn't know about. Mitigation: as new user-scoped tables are added in later slices, they must declare `ON DELETE CASCADE` on `user_id → auth.users(id)` so this deletion path keeps working without code changes.

## Success Criteria (Summary)

- A signed-in user can complete deletion from the UI in under 30 seconds, with a typed-`DELETE` gate, and ends on `/auth/signin?deleted=1` seeing a confirmation banner.
- Post-deletion, no row referencing the deleted `user_id` exists in `auth.users` or `public.flashcards`.
- The deletion endpoint emits exactly one structured `account_deleted` log line per successful deletion and returns 500 (without partial state) on any failure.
