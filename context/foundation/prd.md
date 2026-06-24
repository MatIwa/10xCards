---
project: "10xCards"
version: 1
status: draft
created: 2026-05-27
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-07-05
  after_hours_only: true
---

## Vision & Problem Statement

Creating high-quality flashcards manually is time-consuming, which discourages learners from using spaced repetition — one of the most effective methods for long-term knowledge retention. Professionals in continuing education (doctors, lawyers, engineers) have raw study material but no efficient path to SRS-ready cards.

The insight: existing tools like Anki are powerful for reviewing cards but treat generation as secondary to deck management. No one has nailed AI generation from raw text well enough to make card creation effortless. LLMs now make this possible — the timing is the opportunity.

## User & Persona

**Primary persona**: A professional doing continuing education (doctor, lawyer, engineer) who needs to retain domain knowledge over time. They have access to study material (articles, notes, transcripts) and understand the value of spaced repetition, but the friction of manually writing flashcards discourages consistent use. They reach for this product when they have raw text and want SRS-ready cards without the 30+ minute manual creation effort.

## Success Criteria

### Primary
- 75% of AI-generated flashcards are accepted by users (not rejected or heavily edited)
- 75% of all flashcards in the system are created via AI generation (not manual creation)

### Secondary
- User returns within 7 days for a second session

### Guardrails
- AI generation must respond within a tolerable wait time — users should not abandon the generation flow due to latency
- SR review sessions must never lose progress or show the wrong card — broken reviews destroy trust in the tool

## User Stories

### US-01: User generates flashcards from pasted text

- **Given** a logged-in user on the generation page
- **When** they paste source text and trigger generation
- **Then** they see a list of AI-generated flashcard proposals to accept, edit, or reject

#### Acceptance Criteria
- Generated cards have a clear front (question/prompt) and back (answer)
- User can accept, edit, or reject each generated card individually
- Accepted cards are saved to the user's collection immediately
- Rejected cards are discarded and not persisted
- Empty or too-short source text shows a validation message, not an error

## Functional Requirements

### Authentication
- FR-001: User can create an account (sign up via email + password). Priority: must-have
  > Socrates: No counter-argument; stands as written.
- FR-002: User can log in to an existing account. Priority: must-have
  > Socrates: Counter-argument considered: "supporting multiple auth methods doubles the surface to build, test, and secure." Resolution: narrowed to email+password only for MVP.
- FR-003: User can log out. Priority: must-have
  > Socrates: No counter-argument; trivial consequence of auth.
- FR-014: User can permanently delete their account along with all personal data (flashcards, profile, auth record) — satisfying the GDPR Article 17 right to erasure for EU users. Priority: must-have
  > Socrates: Counter-argument considered: "a soft-delete with a grace period reduces accidental loss." Resolution: GDPR right to erasure requires actual deletion, not retention; a confirmation step in the UI is the appropriate accident guard. Deletion is immediate and irreversible from the user's perspective.

### AI Generation
- FR-004: User can paste source text for AI flashcard generation. Priority: must-have
  > Socrates: No counter-argument; paste is the simplest input mode for MVP. File upload/URL deferred.
- FR-005: User can trigger AI flashcard generation from pasted text. Priority: must-have
  > Socrates: Counter-argument considered: "auto-generate on paste removes a click." Resolution: kept explicit trigger — gives user a moment to review input before committing to generation.
- FR-006: User can review AI-generated flashcard proposals (accept, edit, or reject each). Priority: must-have
  > Socrates: No counter-argument; per-card granular review stands.

### Manual Creation
- FR-007: User can manually create a flashcard (front and back). Priority: must-have
  > Socrates: No counter-argument; safety net for when AI misses a card the user wants.

### Card Management
- FR-008: User can view all their flashcards. Priority: must-have
  > Socrates: No counter-argument; stands as written.
- FR-009: User can edit an existing flashcard. Priority: must-have
  > Socrates: No counter-argument; stands as written.
- FR-010: User can delete a flashcard. Priority: must-have
  > Socrates: No counter-argument; stands as written.

### Spaced Repetition
- FR-011: User can start a spaced repetition review session. Priority: must-have
  > Socrates: Counter-argument considered: "empty review state when nothing is due could feel broken." Resolution: allow optional practice even when nothing is scheduled — user isn't blocked.
- FR-012: User can answer a flashcard during review and see the back. Priority: must-have
  > Socrates: No counter-argument; core SR interaction.
- FR-013: User can rate their recall (scheduling input for the SR algorithm). Priority: must-have
  > Socrates: No counter-argument; stands as written.

## Non-Functional Requirements

- Continuous visible progress during AI generation; all other user-initiated interactions produce a response in under 1 second.
- Source text submitted for flashcard generation is not retained after the generation request completes — no trace in operator-accessible storage.
- The product remains usable on the latest two major versions of Chrome, Firefox, Safari, and Edge.
- The interface is keyboard-navigable, uses semantic HTML, and meets WCAG AA contrast requirements.

## Business Logic

The application decides both WHAT to learn (AI extracts testable knowledge units from unstructured text and frames them as flashcards) and WHEN to review it (spaced repetition scheduling determines the optimal interval for each card's next review).

**What-to-learn rule (extraction)**: The user supplies unstructured text. The application identifies discrete, testable knowledge units within it and transforms each into a question→answer flashcard pair. The user encounters this as a list of proposed cards after triggering generation. The inputs are: raw text pasted by the user. The output is: a set of candidate flashcard pairs (front/back) ranked by extractability.

**When-to-review rule (scheduling)**: Once a card is accepted into the user's collection, the scheduling system determines when that card next appears for review based on the user's recall rating history. The user encounters this as cards surfacing at the right time — not too early (wasted effort), not too late (forgotten). The inputs are: the user's recall ratings over time. The output is: a per-card next-review schedule.

## Access Control

Login-based authentication via email + password. Flat user model — all users have the same capabilities. No role separation in the MVP. Each user's flashcards are private to their account. An unauthenticated user cannot access any flashcard or generation functionality.

## Non-Goals

- **No custom SR algorithm** — use a ready-made spaced repetition library. Building or tuning an algorithm (SuperMemo, Anki-level) is out of scope; the value is in AI generation, not scheduling R&D.
- **No multi-format import** — MVP is paste-only. PDF, DOCX, URL scraping, and file upload are deferred to post-MVP.
- **No sharing or collaboration** — each user's cards are private. No shared decks, social features, or marketplace.
- **No mobile or desktop apps** — web only. No iOS, Android, or desktop wrapper in this version.
- **No offline-first / PWA caching** — the app requires connectivity. No offline review, no service worker caching of cards.

## Open Questions

1. **What are the source text input boundaries?** — US-01 acceptance criteria imply "too-short" text is rejected, but no minimum/maximum character count is defined. Owner: user. Block: no (can ship with a reasonable default, but explicit bounds should be confirmed).
2. **What recall rating granularity does the review use?** — FR-013 says "rate their recall" but doesn't specify binary (know/don't know), 3-level, or 5-level scale. This depends on which ready-made SR library is selected downstream. Owner: tech-stack-selector. Block: no (downstream decision).
3. **What defines "heavily edited" for the 75% acceptance metric?** — Primary success criterion counts cards "not rejected or heavily edited" but does not define the threshold between a minor tweak and a heavy edit. Owner: user. Block: no (can be defined post-launch via analytics).
