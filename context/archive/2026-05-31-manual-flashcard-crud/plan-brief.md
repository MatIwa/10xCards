# Manual Flashcard CRUD — Plan Brief

> Full plan: `context/changes/manual-flashcard-crud/plan.md`

## What & Why

Implement manual flashcard CRUD (create, list, edit, delete) so users have a way to manage their card collection directly. This is the shortest path to populating a deck — required before the spaced repetition review session (S-02) can be meaningful.

## Starting Point

The `flashcards` table with SM-2 metadata and RLS policies is fully deployed (F-01). TypeScript types exist. The dashboard page is a stub showing only email + sign-out. No JSON API routes or Zod validation exist yet — auth routes use form POST + redirect.

## Desired End State

A logged-in user sees their flashcard list on the dashboard, can create new cards (front/back), edit existing cards inline, and delete cards with confirmation. All operations go through a JSON API with server-side Zod validation and respect RLS user isolation.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| API style | JSON API + React fetch | Card management involves many sequential operations — page reloads would feel sluggish. |
| UI location | Dashboard as card hub | Single surface keeps navigation minimal for MVP; user sees cards immediately after login. |
| Card display | Flat list with card rows | Fastest to build and works well for <100 cards; clear scan pattern. |
| Validation | Zod (new dependency) | Establishes the validation pattern for all future routes; structured errors for field-level feedback. |
| Error UX | Inline field errors + general error banner | Clear per-field feedback without page disruption; matches auth form pattern. |
| Delete UX | Inline confirmation | Prevents accidental loss with minimal friction (no modal). |
| Testing | API integration tests | Tests real data integrity and RLS isolation — highest confidence per test line. |

## Scope

**In scope:**
- `GET /api/flashcards` — list user's cards
- `POST /api/flashcards` — create a card (source: manual)
- `PUT /api/flashcards/[id]` — update front/back
- `DELETE /api/flashcards/[id]` — remove card
- Dashboard React island with list, create form, edit form, inline delete confirmation
- Zod request validation with field-level error responses
- shadcn/ui components (input, textarea, card, label)

**Out of scope:**
- Pagination / search / filtering
- Bulk operations
- Card flip preview / study mode (S-02)
- AI generation integration (S-03)
- Optimistic updates
- Client-side routing

## Architecture / Approach

```
Dashboard (Astro page)
  └─ FlashcardList (React island, client:load)
       ├─ FlashcardForm (create/edit mode)
       └─ Card rows (truncated front, source badge, edit/delete)
              │
              ▼ fetch()
       /api/flashcards ─── flashcard.service.ts ─── Supabase (RLS-scoped)
              │
       Zod validation (flashcard.schemas.ts)
```

Service layer wraps Supabase queries; API routes handle auth checks + validation + JSON responses; React island is self-contained and fetches its own data.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Zod + Service Layer | Validation schemas + typed DB operations | Low — Zod install is additive; service wraps existing Supabase client |
| 2. API Routes | JSON endpoints for all 4 CRUD operations | Medium — first JSON API in the project; need to handle auth differently than form routes |
| 3. Dashboard UI | Full card management React island | Medium — largest phase; most new UI code; must integrate with dark theme |

**Prerequisites:** F-01 (flashcard-schema-with-sr) complete — ✓ landed
**Estimated effort:** ~2-3 sessions across 3 phases

## Open Risks & Assumptions

- Assumes <100 cards per user at MVP scale — no pagination needed
- Zod bundle size on server is fine (server-only, no client bundle impact)
- RLS handles all authorization — no additional ownership checks needed in service layer
- shadcn/ui components install cleanly with the existing Tailwind 4 + new-york config

## Success Criteria (Summary)

- User can create, view, edit, and delete flashcards from the dashboard without page reloads
- Invalid input is rejected with clear field-level error messages
- One user cannot see or modify another user's cards (RLS isolation verified)
