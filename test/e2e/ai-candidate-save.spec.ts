// Provenance: E2E for Risk #2 in context/foundation/test-plan.md
//   "Candidate accept/edit/reject state tangled during save — wrong subset
//    persisted, edits dropped, bulk actions apply to hidden rows → silent
//    data loss on the wedge feature."
//
// Modeled on the seed exemplar (test/e2e/seed.spec.ts). What differs vs. the
// seed is the risk-defining slice: this test exercises the AI-candidate flow
// on /dashboard/generate — where the seed only covers manual create — and
// asserts the exact accepted-and-edited subset (and no rejected leftover)
// survives an SSR reload of /dashboard.
//
// Real vs mocked boundaries
// -------------------------
// Real: auth cookie, Astro SSR, POST/DELETE /api/flashcards, Supabase, RLS,
// the entire GenerateFlashcards.tsx client state machine.
// Mocked (browser-edge): POST /api/flashcards/generate — OpenRouter is a
// non-deterministic external service and this app calls it server-side, so
// page.route() at the /generate URL is the closest we can mock without a
// server-side test hook. The mocked boundary is deliberately upstream of
// the risk itself: nothing about how the client shuffles / saves the
// candidates is bypassed.

import { randomUUID } from "node:crypto";
import type { Locator, Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.describe("Risk #2 — AI candidates: only the accepted subset (with edits) persists; rejected never hits DB", () => {
  test("accept one edited + one unedited, reject a third: reload shows exactly the two accepted with the edit intact", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Unique per run so parallel workers and re-runs against the same Supabase
    // instance cannot collide, and so cleanup by-text finds exactly our rows.
    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const acceptedEditedFront = `AI candidate accepted-edited ${runId}`;
    const acceptedEditedBack = `AI candidate accepted-edited back ${runId}`;
    const acceptedOriginalFront = `AI candidate accepted-original ${runId}`;
    const acceptedOriginalBack = `AI candidate accepted-original back ${runId}`;
    const rejectedFront = `AI candidate rejected ${runId}`;
    const rejectedBack = `AI candidate rejected back ${runId}`;
    const editedFrontValue = `${acceptedEditedFront} — edited by user`;

    // Ids of every row this test persists via POST /api/flashcards are pushed
    // here the instant each accept response resolves, so the `finally` below
    // can tear them down even if any subsequent assertion throws mid-flow (see
    // anti-pattern #5 — no cleanup).
    const acceptedIds: string[] = [];

    // Deterministic stand-in for /api/flashcards/generate: three proposals
    // whose fronts are uniquely identifiable. We DO NOT mock POST
    // /api/flashcards — that's the persistence boundary Risk #2 lives at.
    await page.route("**/api/flashcards/generate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          proposals: [
            { id: randomUUID(), front: acceptedEditedFront, back: acceptedEditedBack },
            { id: randomUUID(), front: rejectedFront, back: rejectedBack },
            { id: randomUUID(), front: acceptedOriginalFront, back: acceptedOriginalBack },
          ],
        }),
      });
    });

    try {
      // PLAN step 1: land on the generate page.
      await page.goto("/dashboard/generate");
      await expect(page.getByRole("heading", { name: "Generate flashcards" })).toBeVisible();

      // PLAN step 2: paste source text (server requires ≥200 chars) and generate.
      // NOTE: pressSequentially over fill(). The Textarea is a React 19 controlled
      // input where fill()'s single dispatched input event does not reliably
      // trigger the useState update on this page (React sees the value change,
      // but the counter stays at 0/25000 and canGenerate never flips true).
      // Typing character-by-character produces one input event per keystroke —
      // the equivalent of a real user paste-and-type — and canGenerate turns on.
      // Wait on state (button enabled) before proceeding, never on time.
      const sourceText = `Source text for E2E run ${runId}. `.repeat(10);
      const sourceTextbox = page.getByRole("textbox", { name: "Source text" });
      await sourceTextbox.click();
      await sourceTextbox.pressSequentially(sourceText, { delay: 0 });
      const generateButton = page.getByRole("button", { name: "Generate" });
      await expect(
        generateButton,
        "the Generate button becomes enabled once the source text passes validation",
      ).toBeEnabled();
      const [generateResponse] = await Promise.all([
        page.waitForResponse(
          (response: Response) =>
            response.url().includes("/api/flashcards/generate") && response.request().method() === "POST",
        ),
        generateButton.click(),
      ]);
      expect(generateResponse.status(), "generate request should succeed").toBe(200);

      // PLAN step 3: the three proposals render as listitems in the order the
      // mock returned them. Anchor each listitem by its uniquely-named
      // "Proposal N" checkbox — that's a role+accessibleName pair, unlike the
      // "Proposal N Front" label which is attributed to the front textbox and
      // therefore not visible to Playwright's `hasText`.
      //
      // Important: the "Proposal N" numbering re-indexes as items are removed,
      // so we re-derive locators after every mutation and confirm the intended
      // target via `toHaveValue()` on the front textbox before acting.
      const proposalItemByCheckbox = (name: string): Locator =>
        page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name, exact: true }) });
      const editableFront = (item: Locator): Locator => item.getByRole("textbox", { name: "Editable proposal front" });

      await expect(page.getByRole("listitem"), "three proposals rendered from the mock").toHaveCount(3);
      await expect(editableFront(proposalItemByCheckbox("Proposal 1"))).toHaveValue(acceptedEditedFront);
      await expect(editableFront(proposalItemByCheckbox("Proposal 2"))).toHaveValue(rejectedFront);
      await expect(editableFront(proposalItemByCheckbox("Proposal 3"))).toHaveValue(acceptedOriginalFront);

      // PLAN step 4: edit the first proposal's front. Triple-click + Delete
      // clears via a real interaction sequence, then pressSequentially fills it
      // — same controlled-input rationale as step 2's textarea.
      const editedFrontTextbox = editableFront(proposalItemByCheckbox("Proposal 1"));
      await editedFrontTextbox.click({ clickCount: 3 });
      await editedFrontTextbox.press("Delete");
      await editedFrontTextbox.pressSequentially(editedFrontValue, { delay: 0 });
      await expect(editedFrontTextbox).toHaveValue(editedFrontValue);

      // PLAN step 5: reject the middle proposal. Client-only action, no API call.
      // After the click the list re-indexes: what was Proposal 3 becomes
      // Proposal 2. We wait on state (count drops to 2), never on time, and
      // re-assert the remaining items by their textbox values so a future
      // regression that dropped the wrong proposal or dropped none is caught
      // here — not deferred to the DB check.
      //
      // Notes:
      // - `exact: true` on "Reject" so we never accidentally hit the page-level
      //   "Reject selected" bulk button (substring match would).
      // - dispatchEvent('click') avoids Playwright's post-click stability retry:
      //   the reject re-orders sibling listitems, and a retry after re-render
      //   would fire a SECOND click on the newly-shifted button — the exact
      //   flake we observed (3→1 instead of 3→2).
      const rejectTarget = proposalItemByCheckbox("Proposal 2");
      await expect(rejectTarget, "the middle proposal is the only Proposal-2 match").toHaveCount(1);
      const rejectButton = rejectTarget.getByRole("button", { name: "Reject", exact: true });
      await expect(rejectButton, "one per-item Reject button scoped under Proposal 2").toHaveCount(1);
      await rejectButton.dispatchEvent("click");
      await expect(page.getByRole("listitem"), "count drops to 2 after reject").toHaveCount(2);
      await expect(
        editableFront(proposalItemByCheckbox("Proposal 1")),
        "the edited proposal must remain at position 1 after reject",
      ).toHaveValue(editedFrontValue);
      await expect(
        editableFront(proposalItemByCheckbox("Proposal 2")),
        "the unedited proposal must now occupy position 2 after reject",
      ).toHaveValue(acceptedOriginalFront);

      // PLAN step 6: accept Proposal 1 (edited). Wait for the POST /api/flashcards
      // response — this is the real DB write, and its body must reflect the edit.
      // Same dispatchEvent rationale as above.
      const acceptEditedButton = proposalItemByCheckbox("Proposal 1").getByRole("button", {
        name: "Accept",
        exact: true,
      });
      const [acceptEditedResponse] = await Promise.all([
        page.waitForResponse(
          (response: Response) => response.url().endsWith("/api/flashcards") && response.request().method() === "POST",
        ),
        acceptEditedButton.dispatchEvent("click"),
      ]);
      expect(acceptEditedResponse.status(), "accepting the edited proposal should succeed").toBe(201);
      // Capture the id BEFORE the postData assertion so cleanup covers this row
      // even if the assertion below throws.
      const acceptedEditedBody = (await acceptEditedResponse.json()) as { data: { id: string } };
      acceptedIds.push(acceptedEditedBody.data.id);
      expect(
        acceptEditedResponse.request().postDataJSON(),
        "the edited proposal must persist with the user's edited front + source=ai_edited",
      ).toMatchObject({
        front: editedFrontValue,
        back: acceptedEditedBack,
        source: "ai_edited",
      });
      await expect(page.getByRole("listitem"), "count drops to 1 after the accept resolves").toHaveCount(1);
      await expect(
        editableFront(proposalItemByCheckbox("Proposal 1")),
        "the sole remaining proposal must be the unedited one",
      ).toHaveValue(acceptedOriginalFront);

      // PLAN step 7: accept the remaining proposal (unedited). Its body must
      // carry the AI original values verbatim + source=ai_full.
      const acceptOriginalButton = proposalItemByCheckbox("Proposal 1").getByRole("button", {
        name: "Accept",
        exact: true,
      });
      const [acceptOriginalResponse] = await Promise.all([
        page.waitForResponse(
          (response: Response) => response.url().endsWith("/api/flashcards") && response.request().method() === "POST",
        ),
        acceptOriginalButton.dispatchEvent("click"),
      ]);
      expect(acceptOriginalResponse.status(), "accepting the unedited proposal should succeed").toBe(201);
      // Same rationale as the previous accept: capture the id before any further
      // assertion so `finally` cleans this row up even on mid-flow failure.
      const acceptedOriginalBody = (await acceptOriginalResponse.json()) as { data: { id: string } };
      acceptedIds.push(acceptedOriginalBody.data.id);
      expect(
        acceptOriginalResponse.request().postDataJSON(),
        "the unedited proposal must persist verbatim with source=ai_full",
      ).toMatchObject({
        front: acceptedOriginalFront,
        back: acceptedOriginalBack,
        source: "ai_full",
      });

      // PLAN step 8 (risk-defining check): navigate to /dashboard and reload —
      // the SSR-rendered list must show exactly the two accepted rows with the
      // correct fronts/backs, and the rejected row must be absent.
      await page.goto("/dashboard");
      await page.reload();

      const editedCardAfterReload: Locator = page.getByRole("listitem").filter({ hasText: editedFrontValue });
      const originalCardAfterReload: Locator = page.getByRole("listitem").filter({ hasText: acceptedOriginalFront });
      await expect(
        editedCardAfterReload,
        "the edited card must survive reload with the user's edit intact",
      ).toBeVisible();
      await expect(editedCardAfterReload).toContainText(acceptedEditedBack);
      await expect(
        originalCardAfterReload,
        "the unedited card must survive reload with the AI's original text",
      ).toBeVisible();
      await expect(originalCardAfterReload).toContainText(acceptedOriginalBack);
      await expect(
        page.getByRole("listitem").filter({ hasText: rejectedFront }),
        "the rejected candidate must NEVER appear in the DB-backed dashboard list",
      ).toHaveCount(0);
    } finally {
      // CLEANUP: delete every row we persisted via the real DELETE API so the
      // DB is left exactly as we found it. Best-effort (no expect on status)
      // because this runs even after a mid-flow assertion failure — the
      // primary error should surface, not a cleanup 404. We fire DELETE from
      // inside the page (via page.evaluate + fetch) so the request carries
      // the exact same session cookie the UI would use — page.request's
      // APIRequestContext returned 403 here, likely because the Astro
      // handler's cookie decode expects the browser's Origin/CORS headers
      // that APIRequestContext does not replicate 1:1.
      for (const id of acceptedIds) {
        await page.evaluate(async (flashcardId) => {
          await fetch(`/api/flashcards/${flashcardId}`, { method: "DELETE" });
        }, id);
      }
    }
  });
});
