# Manual Flashcard CRUD — Implementation Plan

## Overview

Implement create, view (list), edit, and delete operations for flashcards. A logged-in user manages their card collection through a JSON API consumed by a React island on the dashboard page. Introduces Zod for server-side validation, a service layer for Supabase queries, and replaces the dashboard stub with a functional card management UI.

## Current State Analysis

- **Database**: `flashcards` table exists with content fields (front/back), source tracking, SM-2 metadata, and RLS policies enforcing per-user isolation (F-01 complete).
- **Types**: `Flashcard` interface and `FlashcardSource` union exported from `src/types.ts`.
- **API layer**: Only auth routes exist (`/api/auth/{signin,signup,signout}`) — form-based POST + redirect. No JSON API pattern established yet.
- **Dashboard**: Stub page showing user email + sign-out button. Protected by middleware.
- **UI**: shadcn/ui `Button` component only. No `Input`, `Textarea`, `Card`, or `Dialog` components installed.
- **Validation**: No Zod. Auth forms do manual client-side validation in React state.

### Key Discoveries:

- `src/lib/supabase.ts:createClient` returns `SupabaseClient | null` — every usage must null-check
- Middleware populates `context.locals.user` with the full Supabase `User` object; `.id` is the UUID matching `flashcards.user_id`
- RLS handles authorization — service layer queries only need to be scoped by the authenticated client; no manual `WHERE user_id = ?` needed when using the user's Supabase session
- `@supabase/ssr` already handles cookie-based auth in SSR context — API routes get the user's session automatically
- DB constraints: front ≤1000 chars, back ≤5000 chars, source must be in `('manual', 'ai_full', 'ai_edited')`

## Desired End State

A logged-in user can:
1. See all their flashcards listed on the dashboard (front text, source badge, creation date)
2. Create a new flashcard by filling in front and back fields
3. Edit any existing flashcard's front/back content inline
4. Delete a flashcard with inline confirmation

Verification: all CRUD operations work via `/api/flashcards` JSON endpoints; `npm run lint` and `npm run build` pass; manual testing confirms RLS isolation (user A cannot see/modify user B's cards).

## What We're NOT Doing

- Pagination or search — flat list is fine for MVP card counts (<100)
- Drag-and-drop reordering
- Bulk operations (multi-select delete)
- Card flip preview / study mode (that's S-02)
- AI generation source tracking UX (that's S-03)
- Optimistic updates — simple loading states are enough
- Client-side routing / SPA navigation

## Implementation Approach

Three phases in dependency order: (1) validation schemas + service layer (data foundation), (2) API routes that expose the service as JSON endpoints, (3) React dashboard UI that consumes the API. Each phase is independently verifiable before the next begins.

## Phase 1: Zod Schemas + Service Layer

### Overview

Install Zod, define request/response DTOs for flashcard operations, and create a service module that encapsulates all Supabase flashcard queries.

### Changes Required:

#### 1. Install Zod

**File**: `package.json`

**Intent**: Add Zod as a runtime dependency for request validation across all current and future API routes.

**Contract**: `zod` added to `dependencies`.

#### 2. Flashcard DTO schemas

**File**: `src/lib/schemas/flashcard.schemas.ts`

**Intent**: Define Zod schemas for create and update flashcard requests, matching database constraints. Export inferred TypeScript types for use in API routes and the service layer.

**Contract**:
- `createFlashcardSchema` — validates `{ front: string (1–1000 chars, trimmed non-empty), back: string (1–5000 chars, trimmed non-empty) }`
- `updateFlashcardSchema` — validates `{ front: string (1–1000 chars, trimmed non-empty), back: string (1–5000 chars, trimmed non-empty) }`
- Exported types: `CreateFlashcardInput`, `UpdateFlashcardInput`

#### 3. Flashcard service

**File**: `src/lib/services/flashcard.service.ts`

**Intent**: Encapsulate all flashcard database operations behind a typed interface. Accepts a Supabase client (already scoped to the user via RLS) and provides list, create, update, and delete methods.

**Contract**:
- `listFlashcards(supabase): Promise<{ data: Flashcard[] | null; error: string | null }>` — SELECT all, ordered by `created_at` DESC
- `createFlashcard(supabase, input: CreateFlashcardInput, userId: string): Promise<{ data: Flashcard | null; error: string | null }>` — INSERT with `source: 'manual'`
- `updateFlashcard(supabase, id: string, input: UpdateFlashcardInput): Promise<{ data: Flashcard | null; error: string | null }>` — UPDATE by id (RLS enforces ownership)
- `deleteFlashcard(supabase, id: string): Promise<{ error: string | null }>` — DELETE by id (RLS enforces ownership)

### Success Criteria:

#### Automated Verification:

- Zod installed: `npm ls zod` shows version
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Schemas reject invalid input (empty strings, over-length) when tested via a scratch script or REPL

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API Routes

### Overview

Create JSON API endpoints for flashcard CRUD at `/api/flashcards` (GET list, POST create) and `/api/flashcards/[id]` (PUT update, DELETE remove). All routes authenticate via Supabase session, validate input with Zod, and return structured JSON responses.

### Changes Required:

#### 1. List + Create endpoint

**File**: `src/pages/api/flashcards/index.ts`

**Intent**: Handle GET (list all user flashcards) and POST (create a new flashcard). Authenticate via Supabase client from request context; reject unauthenticated requests with 401. POST validates body with `createFlashcardSchema`.

**Contract**:
- `GET` → `200 { data: Flashcard[] }` or `500 { error: string }`
- `POST` → `201 { data: Flashcard }` or `400 { error: string, issues?: ZodIssue[] }` or `401 { error: string }`
- Both export uppercase `GET` and `POST` as `APIRoute`

#### 2. Update + Delete endpoint

**File**: `src/pages/api/flashcards/[id].ts`

**Intent**: Handle PUT (update flashcard by id) and DELETE (remove flashcard by id). Authenticate via Supabase client; validate `id` as UUID; PUT validates body with `updateFlashcardSchema`. RLS ensures user can only modify their own cards (404 on not-found-or-not-owned).

**Contract**:
- `PUT` → `200 { data: Flashcard }` or `400 { error: string, issues?: ZodIssue[] }` or `401` or `404 { error: string }`
- `DELETE` → `204 (no body)` or `401` or `404 { error: string }`
- Both export uppercase `PUT` and `DELETE` as `APIRoute`

#### 3. Protect API routes in middleware

**File**: `src/middleware.ts`

**Intent**: Add `/api/flashcards` to the protected routes list so unauthenticated requests get a 401 JSON response (not a redirect to sign-in page, since these are API routes).

**Contract**: API routes under `/api/flashcards` return `401 { error: "Unauthorized" }` for unauthenticated requests instead of redirecting. The existing redirect behavior for page routes (`/dashboard`) is preserved.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `GET /api/flashcards` returns `200 { data: [] }` for authenticated user with no cards
- `POST /api/flashcards` with valid JSON body creates a card and returns `201 { data: {...} }`
- `POST /api/flashcards` with empty front returns `400` with field-level error
- `PUT /api/flashcards/{id}` updates the card
- `DELETE /api/flashcards/{id}` removes the card and returns `204`
- Unauthenticated request returns `401`
- Request with another user's card ID returns `404` (RLS blocks access)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard UI

### Overview

Replace the dashboard stub with a React island that displays the user's flashcard list and provides create, edit, and delete functionality. Install required shadcn/ui components. The island fetches from the JSON API built in Phase 2.

### Changes Required:

#### 1. Install shadcn/ui components

**Intent**: Add the `input`, `textarea`, `card`, and `label` shadcn/ui components needed for the flashcard form and list display.

**Contract**: Run `npx shadcn@latest add input textarea card label` — files land in `src/components/ui/`.

#### 2. Flashcard list component

**File**: `src/components/dashboard/FlashcardList.tsx`

**Intent**: React component that fetches and displays all user flashcards. Shows a loading state on mount, empty state when no cards exist, and a flat list of card rows otherwise. Each row shows truncated front text, source badge, and action buttons (edit, delete).

**Contract**:
- Fetches `GET /api/flashcards` on mount
- Props: none (self-contained island)
- Exposes state for create/edit mode and renders the appropriate form
- Handles delete with inline confirmation pattern (click delete → row shows "Are you sure? [Yes] [Cancel]")

#### 3. Flashcard form component

**File**: `src/components/dashboard/FlashcardForm.tsx`

**Intent**: Reusable form for creating and editing flashcards. Two fields (front, back) with client-side validation (non-empty, length limits). Submits to the API and reports success/errors to the parent list component.

**Contract**:
- Props: `mode: 'create' | 'edit'`, optional `flashcard: Flashcard` (for edit pre-fill), `onSuccess: (card: Flashcard) => void`, `onCancel: () => void`
- Client-side validation: front 1–1000 chars, back 1–5000 chars (mirrors Zod schema)
- Displays field-level errors from API response (`issues` array maps to field names)

#### 4. Dashboard page update

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the welcome stub with the flashcard management React island. Keep the sign-out button. Pass no props — the island is self-contained and fetches its own data.

**Contract**: Renders `<FlashcardList client:load />` inside the Layout. Retains sign-out form. Uses the dark/cosmic theme styling consistent with existing pages.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Dashboard loads and shows empty state for new user
- Creating a card (fill front + back, submit) → card appears in list
- Editing a card → changes reflected immediately in list
- Deleting a card → inline confirmation → card removed from list
- Validation: submitting empty fields shows error messages
- Validation: exceeding character limits shows error messages
- Layout is responsive and readable on mobile viewport

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Zod schemas: verify rejection of empty strings, over-length strings, and acceptance of valid input

### Integration Tests:

- API routes: test full request → response cycle with a Supabase test instance
- RLS isolation: verify that a request scoped to user A cannot read/modify user B's cards
- Error responses: verify proper status codes and error shapes for all failure modes

### Manual Testing Steps:

1. Sign in as test user, navigate to dashboard
2. Verify empty state message displays
3. Create 3 flashcards with varying lengths
4. Edit one card — verify changes persist on page refresh
5. Delete one card with inline confirmation
6. Sign in as a different user — verify no cards visible (RLS isolation)
7. Test validation: try creating with empty front, empty back, over-limit text
8. Test responsive layout on narrow viewport

## Performance Considerations

- No pagination needed for MVP (expecting <100 cards per user)
- Single API call fetches all cards — acceptable at this scale
- React island is `client:load` (not `client:idle`) so cards appear immediately after navigation

## Migration Notes

- No data migration — builds on the empty flashcards table from F-01
- Zod installation is additive — no breaking changes to existing code

## References

- Prerequisite plan: `context/changes/flashcard-schema-with-sr/plan.md`
- PRD functional requirements: FR-007, FR-008, FR-009, FR-010
- Roadmap slice: S-01 in `context/foundation/roadmap.md`
- Existing API pattern: `src/pages/api/auth/signin.ts`
- Supabase client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Zod Schemas + Service Layer

#### Automated

- [x] 1.1 Zod installed: `npm ls zod` shows version — d471b67
- [x] 1.2 Type checking passes: `npx astro check` — d471b67
- [x] 1.3 Linting passes: `npm run lint` — d471b67
- [x] 1.4 Build passes: `npm run build` — d471b67

#### Manual

- [x] 1.5 Schemas reject invalid input when tested manually — d471b67

### Phase 2: API Routes

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 6ec94ed
- [x] 2.2 Linting passes: `npm run lint` — 6ec94ed
- [x] 2.3 Build passes: `npm run build` — 6ec94ed

#### Manual

- [x] 2.4 GET /api/flashcards returns 200 with empty array — 6ec94ed
- [x] 2.5 POST /api/flashcards creates card and returns 201 — 6ec94ed
- [x] 2.6 POST with invalid body returns 400 with field errors — 6ec94ed
- [x] 2.7 PUT /api/flashcards/{id} updates card — 6ec94ed
- [x] 2.8 DELETE /api/flashcards/{id} returns 204 — 6ec94ed
- [x] 2.9 Unauthenticated request returns 401 — 6ec94ed
- [x] 2.10 Cross-user request returns 404 (RLS) — 6ec94ed

### Phase 3: Dashboard UI

#### Automated

- [x] 3.1 Type checking passes: `npx astro check` — de19ded
- [x] 3.2 Linting passes: `npm run lint` — de19ded
- [x] 3.3 Build passes: `npm run build` — de19ded

#### Manual

- [x] 3.4 Dashboard shows empty state for new user — de19ded
- [x] 3.5 Create card flow works end-to-end — de19ded
- [x] 3.6 Edit card flow works end-to-end — de19ded
- [x] 3.7 Delete with inline confirmation works — de19ded
- [x] 3.8 Validation errors display correctly — de19ded
- [x] 3.9 Responsive layout works on mobile viewport — de19ded
