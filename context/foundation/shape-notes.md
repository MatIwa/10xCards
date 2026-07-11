---
project: "10xCards"
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-10
  after_hours_only: true
created: 2026-05-27
updated: 2026-05-27
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — manual card creation discourages SRS use"
    - topic: "insight"
      decision: "no existing tool has nailed AI generation from raw text; Anki treats generation as secondary"
    - topic: "primary persona scope"
      decision: "professional doing continuing education"
    - topic: "auth model"
      decision: "login-based (email+password / OAuth / passwordless); flat user model, no roles"
    - topic: "timeline"
      decision: "3 weeks after-hours; scope fits"
    - topic: "secondary success"
      decision: "user returns within 7 days for a second session"
    - topic: "guardrails"
      decision: "AI generation speed tolerable; SR review sessions never lose progress or show wrong card"
    - topic: "domain rule"
      decision: "two rules — AI extraction (what to learn) + SR scheduling (when to review)"
    - topic: "NFRs"
      decision: "responsiveness, privacy (no source retention), browser support (4 major), accessibility (WCAG AA)"
  frs_drafted: 13
  quality_check_status: accepted
---

## Vision & Problem Statement

Creating high-quality flashcards manually is time-consuming, which discourages learners from using spaced repetition — one of the most effective methods for long-term knowledge retention. Professionals in continuing education (doctors, lawyers, engineers) have raw study material but no efficient path to SRS-ready cards.

The insight: existing tools like Anki are powerful for reviewing cards but treat generation as secondary to deck management. No one has nailed AI generation from raw text well enough to make card creation effortless. LLMs now make this possible — the timing is the opportunity.

## User & Persona

**Primary persona**: A professional doing continuing education (doctor, lawyer, engineer) who needs to retain domain knowledge over time. They have access to study material (articles, notes, transcripts) and understand the value of spaced repetition, but the friction of manually writing flashcards discourages consistent use. They reach for this product when they have raw text and want SRS-ready cards without the 30+ minute manual creation effort.

## Access Control

Login-based authentication (email + password / OAuth / passwordless). Flat user model — all users have the same capabilities. No role separation in the MVP. Each user's flashcards are private to their account.

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

## Business Logic

The application decides both WHAT to learn (AI extracts testable knowledge units from unstructured text and frames them as flashcards) and WHEN to review it (SR algorithm schedules each card at the optimal interval for retention).

**What-to-learn rule (AI extraction)**: The user supplies unstructured text. The AI identifies discrete, testable knowledge units within it and transforms each into a question→answer flashcard pair. The user encounters this as a list of proposed cards after triggering generation. The inputs are: raw text pasted by the user. The output is: a set of candidate flashcard pairs (front/back) ranked by extractability.

**When-to-review rule (SR scheduling)**: Once a card is accepted into the user's collection, the SR algorithm determines when that card next appears for review based on the user's recall rating history. The user encounters this as cards surfacing at the right time — not too early (wasted effort), not too late (forgotten). The inputs are: the user's recall ratings over time. The output is: a per-card next-review schedule.

## Non-Functional Requirements

- Continuous visible progress during AI generation; all other user-initiated interactions produce a response in under 1 second.
- Source text submitted for flashcard generation is not retained after the generation request completes — no trace in operator-accessible storage.
- The product remains usable on the latest two major versions of Chrome, Firefox, Safari, and Edge.
- The interface is keyboard-navigable, uses semantic HTML, and meets WCAG AA contrast requirements.

## Non-Goals

- **No custom SR algorithm** — use a ready-made spaced repetition library. Building or tuning an algorithm (SuperMemo, Anki-level) is out of scope; the value is in AI generation, not scheduling R&D.
- **No multi-format import** — MVP is paste-only. PDF, DOCX, URL scraping, and file upload are deferred to post-MVP.
- **No sharing or collaboration** — each user's cards are private. No shared decks, social features, or marketplace.
- **No mobile or desktop apps** — web only. No iOS, Android, or desktop wrapper in this version.
- **No offline-first / PWA caching** — the app requires connectivity. No offline review, no service worker caching of cards.

## Quality cross-check

All elements present. Minor note: Access Control section mentions "OAuth / passwordless" but FR-002 Socrates round narrowed to email+password only for MVP. /10x-prd should resolve from FRs as authoritative source.
