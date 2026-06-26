---
change_id: account-deletion-gdpr
title: Account deletion with full data erasure (GDPR)
status: implemented
created: 2026-06-24
updated: 2026-06-26
archived_at: null
---

## Notes

Roadmap slice **S-04** in `context/foundation/roadmap.md` — GDPR Article 17 right to erasure for EU users. Permanently delete the account from a settings/profile area with explicit confirmation; wipe flashcards, profile, and Supabase auth record, then sign the user out.

- PRD refs: FR-014
- Prerequisites: F-01 (already CLOSED — `flashcard-schema-with-sr`)
- Parallel with: S-01, S-02, S-03
- Stream: C (Compliance)

When creating the GitHub issue, append a new row to `context/foundation/tasks-github.md`:

- Roadmap ID: `S-04`
- Title: `Account deletion with full data erasure (GDPR)`
- Labels: `slice`, `stream:C` (new label — pick a color; suggest `#fbca04` / yellow for compliance)
- Prerequisites: `#1` (F-01)

Open unknowns to resolve at `/10x-plan` time:

- Entry point location (settings page vs. profile menu)
- Deletion mechanism: server endpoint calling `auth.admin.deleteUser` with service-role key vs. DB trigger from user-initiated row deletion
- Verify `ON DELETE CASCADE` from `flashcards.user_id` → `auth.users.id` is in place (per F-01 migration)

Risk highlight from roadmap: erasure must be complete and irreversible; partial deletes breach GDPR. Service-role key must stay server-side only.
