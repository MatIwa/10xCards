# Account Deletion (GDPR) Implementation Plan

## Overview

Add an irreversible "Delete account" flow that satisfies GDPR Article 17 right to erasure. A logged-in user opens `/dashboard/settings`, confirms by typing `DELETE` (or their email), and a server endpoint uses a Supabase service-role admin client to delete their `auth.users` row. The existing `ON DELETE CASCADE` on `flashcards.user_id → auth.users(id)` wipes their cards. The endpoint verifies orphan-freedom with a follow-up count check, logs a structured audit record, signs the user out, and redirects to `/auth/signin?deleted=1` where a one-shot banner confirms the deletion.

## Current State Analysis

- **Cascade in place**: [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) declares `user_id uuid not null references auth.users(id) on delete cascade`, and the FSRS migration ([20260601120000_flashcards_fsrs.sql](../../../supabase/migrations/20260601120000_flashcards_fsrs.sql)) does not alter that constraint. A single `auth.users` delete cascades to every owned flashcard.
- **Only user-owned data**: `public.flashcards` is the sole user-scoped table in `supabase/migrations/`. PRD NFR forbids retaining AI source text, so there are no other persisted artifacts to erase.
- **No service-role wiring**: [astro.config.mjs](../../../astro.config.mjs) declares only `SUPABASE_URL`, `SUPABASE_KEY` (anon), `OPENROUTER_API_KEY`. [src/lib/supabase.ts](../../../src/lib/supabase.ts) builds an anon SSR client; no admin client exists. [.env.example](../../../.env.example) and [.dev.vars](../../../.dev.vars) match.
- **No settings surface yet**: [src/pages/dashboard.astro](../../../src/pages/dashboard.astro) has "Generate cards / Review / Sign out". [src/components/Topbar.astro](../../../src/components/Topbar.astro) has "Dashboard / Sign out". No `/dashboard/settings` route.
- **Established API pattern**: Zod schema in `src/lib/schemas/`, business logic in `src/lib/services/`, uppercase HTTP-method handlers in `src/pages/api/`. Existing reference: [src/pages/api/flashcards/index.ts](../../../src/pages/api/flashcards/index.ts) + [src/lib/services/flashcard.service.ts](../../../src/lib/services/flashcard.service.ts).
- **Middleware gates protected prefixes**: [src/middleware.ts](../../../src/middleware.ts) protects `/dashboard` (redirect) and `/api/flashcards` (401 JSON). `/api/account` is not yet gated.
- **No dialog component installed**: [src/components/ui/](../../../src/components/ui) has `button`, `card`, `input`, `label`, `textarea`. No `dialog` or `alert-dialog`. shadcn ("new-york") is configured via [components.json](../../../components.json).
- **Existing banner primitive**: [src/components/Banner.astro](../../../src/components/Banner.astro) is used in [src/layouts/Layout.astro](../../../src/layouts/Layout.astro) for `missingConfigs`; the `?deleted=1` banner reuses the same component.
- **Sign-in page**: [src/pages/auth/signin.astro](../../../src/pages/auth/signin.astro) already reads `?error=` from the URL; reading `?deleted=1` is the same pattern.

### Key Discoveries

- The Supabase service-role key must NEVER appear in client bundles. With `astro:env/server`'s `access: "secret"` it stays server-only by construction — the same guarantee already used for `SUPABASE_KEY` and `OPENROUTER_API_KEY` in [astro.config.mjs](../../../astro.config.mjs).
- `supabase.auth.admin.deleteUser(userId)` requires a Supabase client built with the service-role key. It cannot be called from the user's anon SSR client; we need a separate admin client constructed inside the endpoint (no cookies, no session).
- The post-delete verification check (`select id from public.flashcards where user_id = $1 limit 1`) runs on the admin client so RLS does not hide residual rows during the check. Using the user's anon client here would defeat the verification.
- The endpoint needs both clients at once: the **user-scoped** anon client to call `signOut()` and clear the auth cookies on the response, and the **admin** client to perform the destructive work.

## Desired End State

A logged-in user can:

1. Navigate to `/dashboard/settings` (a "Settings" link is reachable from the topbar / dashboard).
2. See a "Danger zone" card showing the irreversibility warning and the live count of their flashcards.
3. Click "Delete account" → a modal opens, displays `All your flashcards (N) will be permanently deleted.`, and disables the destructive button until the user types `DELETE` (case-sensitive) into a confirmation field.
4. Confirm → the page submits to `POST /api/account/delete`; on success the server signs them out, clears cookies, and 303-redirects to `/auth/signin?deleted=1`.
5. On `/auth/signin?deleted=1` a banner reads "Your account and all your data have been permanently deleted." The next sign-up creates a fresh account.

Verification:

- `select 1 from auth.users where id = $UID` returns 0 rows after deletion.
- `select count(*) from public.flashcards where user_id = $UID` returns 0 after deletion.
- The endpoint emits a single structured `console.log` record `{ event: "account_deleted", user_id, flashcards_deleted_count, timestamp }`.
- `npm run lint` and `npm run build` pass; manual test confirms full flow.

## What We're NOT Doing

- **No soft delete / grace period** — PRD §FR-014 explicitly chooses immediate, irreversible deletion. No "Undo within 7 days" feature.
- **No password re-authentication step** — typed confirmation is the chosen friction (8-question round confirmed). Password re-auth is deferred until SSO arrives.
- **No data export / download before deletion** — outside the scope of this slice. Add later if a separate GDPR Article 20 (portability) requirement lands.
- **No audit table** — structured `console.log` lands in Cloudflare observability. Persisting an `audit_log` Postgres row is deferred until a real audit framework exists.
- **No new shared settings infrastructure** — `/dashboard/settings` is shipped with just the Danger Zone card. Future preferences (theme, notifications) are out of scope here.
- **No deletion of users without flashcards via a different code path** — the count check tolerates 0 flashcards (it is the success state); no branching on whether the user had cards.
- **No bulk admin operations** — `auth.admin.deleteUser` is called for the currently signed-in user only; the endpoint reads the user from the session, never from the request body.

## Implementation Approach

Two phases in strict dependency order.

**Phase 1** lands the deletion contract end-to-end at the API layer: env var, admin client helper, schema, service, endpoint, and middleware update. After Phase 1, the deletion can be exercised by hitting `POST /api/account/delete` manually (e.g., via DevTools console) — this is a deliberate checkpoint so the destructive contract is verified before any UI surface exposes it.

**Phase 2** layers the safe UX on top: dedicated settings page, confirmation dialog with typed-input gate, count-of-cards display, entry-point wiring in Topbar/Dashboard, and the post-delete banner on `/auth/signin`.

## Critical Implementation Details

- **Two Supabase clients in the deletion endpoint**: the existing anon `createClient(request.headers, cookies)` is needed to call `supabase.auth.signOut({ scope: 'local' })` so the user's cookies are cleared on the response. A separate admin client (service-role key, no cookies) performs `auth.admin.deleteUser(userId)` and the verification count. Calling `signOut({ scope: 'local' })` AFTER the admin delete is the correct ordering: the auth row is already gone, and `scope: 'local'` is a pure cookie clear via the SSR adapter — no server round-trip to the now-defunct session, so it cannot fail on a 401/404 from `/auth/v1/logout`. Any error from `signOut` is intentionally ignored (the destructive work already succeeded; we only need cookies cleared).
- **Verification count must use the admin client**: a `select` from the user's anon client after deleting `auth.users` would race with session invalidation and could be rejected by RLS. The admin client bypasses RLS and gives a deterministic answer.
- **Service-role key isolation**: declare with `access: "secret", context: "server"` in `astro.config.mjs` so the build refuses to import it from client code. Build the admin client only inside `src/lib/supabase-admin.ts` and import that module only from `src/pages/api/account/delete.ts`. No other module should import it.

## Phase 1: Backend — admin client + deletion endpoint

### Overview

Wire `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret, build a single-purpose admin Supabase client, define a Zod confirmation-payload schema, add an `account.service.ts` with `deleteAccount` + `countRemainingFlashcards`, implement `POST /api/account/delete`, and extend `src/middleware.ts` to protect `/api/account` with the same 401-JSON behavior used for `/api/flashcards`.

### Changes Required

#### 1. Declare service-role env var

**File**: [astro.config.mjs](../../../astro.config.mjs)

**Intent**: Make `SUPABASE_SERVICE_ROLE_KEY` available to server code via `astro:env/server` with `access: "secret"` so it is never bundled into client output. Keep it optional so missing-config behavior (the existing banner pattern) still applies in unconfigured environments.

**Contract**: `env.schema` gains `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true })`. No other config changes.

#### 2. Document the new secret

**File**: [.env.example](../../../.env.example)

**Intent**: Tell future contributors which secret to set locally and in Cloudflare.

**Contract**: Append `SUPABASE_SERVICE_ROLE_KEY=###` with a short inline comment noting it is server-only and used for account deletion.

#### 3. Extend config-status surface

**File**: [src/lib/config-status.ts](../../../src/lib/config-status.ts)

**Intent**: When the service-role key is absent, the Danger Zone in the UI must not silently no-op — the missing-config banner pattern already used for Supabase generally is the right signal. Adds a new `ConfigStatus` entry that surfaces in [src/layouts/Layout.astro](../../../src/layouts/Layout.astro) when the key is unset.

**Contract**: Import `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server`, append a `configStatuses` entry with `name: "Supabase service role"`, `configured: Boolean(SUPABASE_SERVICE_ROLE_KEY)`, and a Polish message consistent with the existing Supabase entry, indicating account deletion is unavailable until configured.

#### 4. Admin Supabase client helper

**File**: `src/lib/supabase-admin.ts` (new)

**Intent**: Single export that builds a service-role Supabase client for admin operations. Distinct module so the service-role key has exactly one import site; any future code review can scan for imports of this file to audit privilege boundaries.

**Contract**:

- Exports `createAdminClient(): SupabaseClient | null`
- Returns `null` when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset
- Built with `@supabase/supabase-js` `createClient` (not `@supabase/ssr`) — no cookies, no session persistence: pass `auth: { persistSession: false, autoRefreshToken: false }`
- No request/response context parameters — the admin client is stateless

#### 5. Account deletion Zod schema

**File**: `src/lib/schemas/account.schemas.ts` (new)

**Intent**: Validate the JSON body of the deletion request. Even though the typed-confirmation UX guards the client, the server must independently verify the confirmation token to refuse stray/malicious requests.

**Contract**:

- `deleteAccountSchema` validates `{ confirmation: z.literal("DELETE") }`
- Exports `DeleteAccountInput` inferred type

#### 6. Account service

**File**: `src/lib/services/account.service.ts` (new)

**Intent**: Encapsulate the destructive sequence: delete the auth user via the admin client, then verify no orphaned flashcards remain. Mirrors the structure of [flashcard.service.ts](../../../src/lib/services/flashcard.service.ts) (returns `{ data, error }` or `{ error }`).

**Contract**:

- `deleteAccount(adminClient: SupabaseClient, userId: string): Promise<{ deletedFlashcards: number; error: string | null }>`
  - Step 1: count the rows that are about to be wiped: `await adminClient.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", userId)` and read `response.count` (default to `0` if null). `head: true` skips the row body so the request returns no data — only the count. This read happens BEFORE the delete so the count reflects what was wiped, not what survived.
  - Step 2: `await adminClient.auth.admin.deleteUser(userId)` — if it errors, return `{ deletedFlashcards: 0, error: <message> }` without proceeding.
  - Step 3: verification — `select id from public.flashcards where user_id = $userId limit 1` via admin client; if any row is returned, return `{ deletedFlashcards: <pre-count>, error: "Verification failed: orphaned flashcards remain" }`.
  - Step 4: on full success, return `{ deletedFlashcards: <pre-count>, error: null }`.
- **Required inline comment** on the verification block (Step 3), kept verbatim so future maintainers can't miss it:
  ```ts
  // TABLES: this orphan-check must list every user-scoped table.
  // When adding any new table with user_id -> auth.users(id), declare
  // `on delete cascade` in its migration AND extend this verification.
  // See context/foundation/lessons.md (user-scoped tables rule).
  ```

#### 7. Deletion endpoint

**File**: `src/pages/api/account/delete.ts` (new)

**Intent**: HTTP boundary that ties everything together: authenticate via the user's session, validate the typed-confirmation body, call the service, log the audit record, sign the user out, redirect to `/auth/signin?deleted=1`.

**Contract**:

- `POST` handler exported as `APIRoute`
- Build both the user-scoped client (`createClient(request.headers, cookies)`) and the admin client (`createAdminClient()`); return 500 `{ error: "Account deletion is not configured" }` if either is null.
- 401 `{ error: "Unauthorized" }` if `context.locals.user` is falsy.
- Parse JSON body; validate with `deleteAccountSchema`; return 400 with Zod issues on failure (same shape as flashcards endpoint).
- Call `deleteAccount(adminClient, context.locals.user.id)`.
- On error: `console.error("account_delete_failed", { user_id, error })`; return 500 `{ error: "Deletion failed — please try again later." }`. Do NOT call `signOut()` — keep the user signed in so they can retry.
- On success:
  - `console.log` a single line of JSON `{ event: "account_deleted", user_id, flashcards_deleted_count, timestamp: new Date().toISOString() }`.
  - `await userSupabase.auth.signOut({ scope: 'local' })` to clear cookies on the response. Use local scope (not the default global) because the auth row is already deleted — a server-side `/auth/v1/logout` call would race against the now-defunct session. Errors are intentionally ignored: if cookie-clearing fails for any reason, we still must return the success redirect because the account has been destroyed.
  - Return `context.redirect("/auth/signin?deleted=1", 303)`.

**Contract** (snippet — kept because the ordering and dual-client construction is non-obvious and other phases depend on this exact sequence):

```ts
const userSupabase = createClient(context.request.headers, context.cookies);
const adminSupabase = createAdminClient();
if (!userSupabase || !adminSupabase) {
  return Response.json({ error: "Account deletion is not configured" }, { status: 500 });
}
if (!context.locals.user) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
// ... validate body with deleteAccountSchema ...
const { deletedFlashcards, error } = await deleteAccount(adminSupabase, context.locals.user.id);
if (error) {
  console.error("account_delete_failed", { user_id: context.locals.user.id, error });
  return Response.json({ error: "Deletion failed — please try again later." }, { status: 500 });
}
console.log(
  JSON.stringify({
    event: "account_deleted",
    user_id: context.locals.user.id,
    flashcards_deleted_count: deletedFlashcards,
    timestamp: new Date().toISOString(),
  }),
);
// Local scope: cookie clear only, no server round-trip to the deleted user's session.
// Errors are deliberately ignored — the destructive work succeeded and we must still redirect.
await userSupabase.auth.signOut({ scope: "local" }).catch(() => {});
return context.redirect("/auth/signin?deleted=1", 303);
```

#### 8. Protect `/api/account` in middleware

**File**: [src/middleware.ts](../../../src/middleware.ts)

**Intent**: Treat `/api/account` as a JSON-protected prefix (401 JSON, not redirect), consistent with `/api/flashcards`.

**Contract**: Append `"/api/account"` to `PROTECTED_API_PREFIXES`. No other middleware changes.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- No client bundle references the admin key: `grep -r "SUPABASE_SERVICE_ROLE_KEY" dist/` after build returns no matches.

#### Manual Verification

- With service-role key set in `.dev.vars`, `npx supabase start` running, and a seeded test user, calling `POST /api/account/delete` with body `{"confirmation":"DELETE"}` via DevTools fetch returns a 303 redirect to `/auth/signin?deleted=1`.
- `select 1 from auth.users where id = <test_uid>` returns 0 rows after the call.
- `select count(*) from public.flashcards where user_id = <test_uid>` returns 0 after the call.
- `POST /api/account/delete` without `confirmation: "DELETE"` returns 400 with Zod issues.
- `POST /api/account/delete` unauthenticated returns 401 JSON (not a redirect).
- Cloudflare/local worker logs show a single `{ event: "account_deleted", ... }` line on success.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Frontend — settings page + confirmation UX

### Overview

Install the shadcn `dialog` component, build `/dashboard/settings.astro` with a Danger Zone card hosting a React `DeleteAccountDialog` island (typed confirmation, card-count display, native form POST to `/api/account/delete`), add a "Settings" entry point on Topbar and Dashboard, and render a one-time confirmation banner on `/auth/signin?deleted=1`.

### Changes Required

#### 1. Install shadcn dialog component

**Intent**: The current `ui/` directory has no modal primitive; the typed-confirmation step requires one.

**Contract**: Run `npx shadcn@latest add dialog`. New file `src/components/ui/dialog.tsx` lands.

#### 2. Settings page

**File**: `src/pages/dashboard/settings.astro` (new)

**Intent**: Astro SSR page protected by the existing `/dashboard` middleware prefix. Hosts the Topbar, page title, and a single "Danger zone" card containing the React deletion island. Page also fetches the user's flashcard count server-side so the island starts with an accurate number (avoids a loading flash inside the modal).

**Contract**:

- Reads `Astro.locals.user`; builds the user-scoped Supabase client via `createClient`; queries `select count from flashcards` (head: true, count: "exact") to get the current card count for the signed-in user.
- Renders a "Settings" heading and a single "Danger zone" `<Card>` with explanatory copy and the `<DeleteAccountDialog client:load flashcardCount={count} userEmail={user.email} />` island.
- Renders the existing Topbar at the top.

#### 3. Delete account dialog island

**File**: `src/components/dashboard/DeleteAccountDialog.tsx` (new)

**Intent**: React component that owns the destructive confirmation flow. Trigger button opens the dialog; dialog shows what will be deleted; the destructive "Delete account" button is disabled until the user types `DELETE` (case-sensitive) into a confirmation `<Input>`. On submit, the component performs a native form POST to `/api/account/delete` with `{ confirmation: "DELETE" }` so the server's 303 redirect navigates the browser to `/auth/signin?deleted=1` automatically.

**Contract**:

- Props: `{ flashcardCount: number; userEmail: string }`
- Trigger button copy: "Delete account" — destructive styling (red background; reuse `Button` variant or className).
- Dialog body must include: irreversibility warning, the literal sentence `All your flashcards (N) will be permanently deleted.` with `N` interpolated, and the user's email as identity affirmation.
- Confirmation input: typing `DELETE` enables the destructive button. Any other value (or empty) keeps it disabled.
- On submit:
  - Send `fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE" }), redirect: "follow" })` and, when the response is the 303 redirect, navigate the window to the final URL (`window.location.assign(response.url)`). Use `redirect: "follow"` so the fetch transparently follows the 303 and `response.url` is the final URL.
  - On non-OK response: surface the error message inside the dialog ("Deletion failed — please try again later.") and keep the dialog open. Do not navigate.
- Show a disabled / busy state on the destructive button during the request (so the user cannot double-fire).

**Contract** (snippet — fetch + redirect handling is the load-bearing piece other parts of the plan rely on; rest is routine UI):

```tsx
const response = await fetch("/api/account/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirmation: "DELETE" }),
  redirect: "follow",
});
if (response.redirected) {
  window.location.assign(response.url);
  return;
}
// non-redirect path = failure: surface response error in-dialog, keep modal open
```

#### 4. Topbar settings link

**File**: [src/components/Topbar.astro](../../../src/components/Topbar.astro)

**Intent**: Add a "Settings" link visible only when the user is signed in, placed between the dashboard link and the sign-out form.

**Contract**: Inside the `user ?` branch, after the existing `<a href="/dashboard">` and before the sign-out `<form>`, add `<a href="/dashboard/settings" class="text-purple-300 transition-colors hover:text-purple-100 hover:underline">Settings</a>`. No other Topbar changes.

#### 5. Dashboard settings entry

**File**: [src/pages/dashboard.astro](../../../src/pages/dashboard.astro)

**Intent**: Add a "Settings" link to the dashboard's action bar so users have a visible path in addition to the Topbar.

**Contract**: Inside the `flex-wrap` action bar, add a `<a href="/dashboard/settings">` styled to match the existing secondary action (the sign-out button's border/bg classes), placed before the sign-out `<form>`. Copy: "Settings".

#### 6. Post-delete banner on sign-in

**File**: [src/pages/auth/signin.astro](../../../src/pages/auth/signin.astro)

**Intent**: When the URL has `?deleted=1`, render a one-time success banner above the form confirming the account has been erased.

**Contract**: Read `Astro.url.searchParams.get("deleted") === "1"`; when true, render `<Banner variant="info">` with copy `Your account and all your data have been permanently deleted.`. `info` is chosen deterministically because `Banner.astro` only supports `"info" | "warning" | "error"` — adding a real `"success"` variant is explicitly out of scope for this slice. Banner renders independently of the existing `?error=` handling — both can appear if the URL has both params.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- `src/components/ui/dialog.tsx` exists after running `npx shadcn@latest add dialog`.

#### Manual Verification

- Topbar shows "Settings" link when signed in; clicking it lands on `/dashboard/settings`.
- `/dashboard/settings` shows the Danger zone card with the user's actual flashcard count.
- Clicking "Delete account" opens the modal; the destructive button is disabled.
- Typing anything other than `DELETE` keeps the button disabled.
- Typing `DELETE` exactly enables the button.
- Clicking the enabled destructive button erases the account and lands the browser on `/auth/signin?deleted=1`.
- A success banner reads "Your account and all your data have been permanently deleted." on that page.
- Attempting to sign in with the deleted credentials fails with the standard sign-in error.
- Signing up with the same email creates a fresh account with zero flashcards.
- Hitting `/dashboard/settings` unauthenticated redirects to `/auth/signin` (existing middleware behavior).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering the change complete.

---

## Testing Strategy

### Unit Tests

- No new unit test files in this slice — repo has no test runner installed yet (consistent with prior changes such as `manual-flashcard-crud`). Add tests in a later slice when the project introduces a test framework.

### Integration Tests

- Covered by manual verification (see each phase's "Manual Verification"). The destructive nature of the endpoint is a poor fit for repeated CI runs without isolated test DB infra.

### Manual Testing Steps

1. Configure `SUPABASE_SERVICE_ROLE_KEY` in `.dev.vars`; run `npx supabase start` and `npm run dev`.
2. Sign up a new user; sign in; create at least 3 flashcards manually.
3. Open the Topbar → "Settings"; verify the count of flashcards in the Danger zone matches what you created.
4. Click "Delete account"; verify the destructive button is disabled by default.
5. Type `delete` (lowercase) — button stays disabled. Type `DELETE` — button enables.
6. Click the destructive button; verify the browser lands on `/auth/signin?deleted=1` with the confirmation banner.
7. Inspect local Postgres (`psql` via `supabase status` connection details): `select 1 from auth.users where email = '<test_email>'` returns 0 rows; `select count(*) from public.flashcards` is zero for the deleted user.
8. Inspect worker logs (`npm run dev` output) — single `{"event":"account_deleted",...}` JSON line is present.
9. Attempt to sign in with the deleted user's credentials — sign-in fails with standard error message.
10. Sign up again with the same email; verify it creates a fresh user with zero cards.

## Performance Considerations

The deletion endpoint runs at most three Postgres round-trips (pre-count select, `auth.admin.deleteUser`, post-count verify) plus a local-scope `signOut()` cookie clear (no extra round-trip). The action is per-user and rare — no performance budget concerns. Cloudflare Workers cold start cost on the admin client construction is negligible because the request is user-initiated.

## Migration Notes

No schema migration in this slice. The existing `ON DELETE CASCADE` declared in [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) is the entire data-layer dependency. Cloudflare deployment requires running `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` before the feature can work in production — flag this in the deployment checklist when merging.

## References

- PRD: [context/foundation/prd.md](../../foundation/prd.md) — FR-014
- Roadmap: [context/foundation/roadmap.md](../../foundation/roadmap.md) — S-04 (Stream C, Compliance)
- Pattern reference (service + schema + endpoint): [context/changes/manual-flashcard-crud/plan.md](../manual-flashcard-crud/plan.md)
- Cascade declaration: [supabase/migrations/20260531120000_create_flashcards.sql](../../../supabase/migrations/20260531120000_create_flashcards.sql) line 13
- Env declaration pattern: [astro.config.mjs](../../../astro.config.mjs) lines 13–18
- Anon client builder: [src/lib/supabase.ts](../../../src/lib/supabase.ts)
- Middleware protection pattern: [src/middleware.ts](../../../src/middleware.ts)
- Sign-in URL-param consumption pattern: [src/pages/auth/signin.astro](../../../src/pages/auth/signin.astro)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — admin client + deletion endpoint

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — 63c9322
- [x] 1.2 Linting passes: `npm run lint` — 63c9322
- [x] 1.3 Build passes: `npm run build` — 63c9322
- [x] 1.4 No client bundle references the admin key: `grep -r "SUPABASE_SERVICE_ROLE_KEY" dist/` returns no matches — 63c9322

#### Manual

- [x] 1.5 `POST /api/account/delete` with `{"confirmation":"DELETE"}` returns a 303 redirect to `/auth/signin?deleted=1` — 63c9322
- [x] 1.6 `select 1 from auth.users where id = <test_uid>` returns 0 rows after the call — 63c9322
- [x] 1.7 `select count(*) from public.flashcards where user_id = <test_uid>` returns 0 after the call — 63c9322
- [x] 1.8 `POST /api/account/delete` without `confirmation: "DELETE"` returns 400 with Zod issues — 63c9322
- [x] 1.9 `POST /api/account/delete` unauthenticated returns 401 JSON (not a redirect) — 63c9322
- [x] 1.10 Worker logs show a single `{ event: "account_deleted", ... }` line on success — 63c9322

### Phase 2: Frontend — settings page + confirmation UX

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build passes: `npm run build`
- [x] 2.4 `src/components/ui/dialog.tsx` exists after running `npx shadcn@latest add dialog`

#### Manual

- [x] 2.5 Topbar shows "Settings" link when signed in; clicking it lands on `/dashboard/settings`
- [x] 2.6 `/dashboard/settings` shows the Danger zone card with the user's actual flashcard count
- [x] 2.7 Clicking "Delete account" opens the modal with the destructive button disabled
- [x] 2.8 Typing anything other than `DELETE` keeps the button disabled
- [x] 2.9 Typing `DELETE` exactly enables the button
- [x] 2.10 Clicking the enabled destructive button erases the account and lands the browser on `/auth/signin?deleted=1`
- [x] 2.11 A success banner reads "Your account and all your data have been permanently deleted." on that page
- [x] 2.12 Attempting to sign in with the deleted credentials fails with the standard sign-in error
- [x] 2.13 Signing up with the same email creates a fresh account with zero flashcards
- [x] 2.14 Hitting `/dashboard/settings` unauthenticated redirects to `/auth/signin`
