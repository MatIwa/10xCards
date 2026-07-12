// Provenance: seed exemplar for this project's E2E suite.
// Risk anchor: context/foundation/test-plan.md — Risk #2
//   "Candidate accept/edit/reject state tangled during save — wrong subset persisted,
//    edits dropped, bulk actions apply to hidden rows → silent data loss on the wedge feature."
//
// This seed test protects the smallest slice of that risk that crosses every real
// boundary the AI-candidate flow also crosses (auth → SSR routing → Astro API route →
// Supabase RLS → DB → page reload). The manual-create flow is the cheapest exemplar
// for the "data actually survives across the boundary" contract; every future E2E for
// Risk #2 (AI candidate accept/edit/reject → save) is generated from this seed's
// shape, so what's shown here is what agents will reproduce:
//
//   1. Role-based locators only (getByRole / getByLabel) — no CSS selectors, no XPath,
//      no getByTestId (add only when accessibility attributes are genuinely ambiguous).
//   2. Wait for state, never for time — expect(locator).toBeVisible(),
//      waitForResponse(); no page.waitForTimeout().
//   3. Unique test data — a Date.now() + randomUUID() suffix so parallel runs and
//      re-runs against the same DB cannot collide.
//   4. Test independence + cleanup — own setup, action, assertion, cleanup; auth via
//      storageState (see test/e2e/setup/auth.setup.ts), never through the UI.
//   5. Test name binds unambiguously to the risk in test-plan.md.
//
// Real vs mocked boundaries: everything internal (auth cookie, /api/flashcards route,
// Supabase, RLS) runs for real — that's exactly where Risk #2 hides. No external
// service is involved in the manual-create path, so nothing is mocked.

import { randomUUID } from "node:crypto";
import type { Locator, Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.describe("Risk #2 — flashcard save persists the exact content across boundaries", () => {
  test("a manually created flashcard survives a full page reload with its content intact", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Unique per run — timestamp for ordering + UUID fragment for collision-safety
    // under parallel workers and re-runs against the same Supabase instance.
    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const front = `Seed front ${runId}`;
    const back = `Seed back ${runId}`;

    // PLAN step 1: land on the dashboard (auth is supplied by the shared
    // storageState — the E2E project depends on an `auth.setup.ts` that signs
    // in once and writes the session; individual tests never touch /auth/signin).
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // PLAN step 2: open the create form.
    const newFlashcardButton = page.getByRole("button", { name: "New flashcard" });
    await newFlashcardButton.click();

    const createFormHeading = page.getByRole("heading", { name: "Create flashcard" });
    if (!(await createFormHeading.isVisible())) {
      // If hydration lag swallowed the first click, retry once and assert state change.
      await newFlashcardButton.click();
    }
    await expect(createFormHeading).toBeVisible();

    // PLAN step 3: fill front + back. `getByLabel` reads more naturally than
    // `getByRole('textbox', { name })` for form fields, but both are accessibility-tree
    // based — pick whichever makes the intent clearer; never fall back to CSS.
    await page.getByRole("textbox", { name: "Front" }).fill(front);
    await page.getByRole("textbox", { name: "Back" }).fill(back);

    // PLAN step 4: submit. We wait for the API response (state), not a timeout,
    // so the assertion cannot race the network. `waitForResponse` starts BEFORE
    // the click that triggers it — the Promise.all pattern is the canonical shape.
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response: Response) => response.url().endsWith("/api/flashcards") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(createResponse.status(), "create request should succeed").toBe(201);

    // PLAN step 5: the new card is now in the rendered list.
    const cardBeforeReload: Locator = page.getByRole("listitem").filter({ hasText: front });
    await expect(cardBeforeReload).toBeVisible();

    // PLAN step 6 (the risk-defining check): reload and confirm the exact same
    // content is served back by SSR — this is what fails if the save wrote the
    // wrong subset, dropped edits, or persisted to a different user's scope.
    await page.reload();
    const cardAfterReload: Locator = page.getByRole("listitem").filter({ hasText: front });
    await expect(cardAfterReload).toBeVisible();
    await expect(cardAfterReload).toContainText(back);

    // CLEANUP: delete via the UI so the test leaves the DB exactly as it found
    // it. Two-step confirm — the top action button flips to "Cancel" once a
    // delete is pending, so the confirmation block's "Delete" is unambiguous.
    // We again wait for the API response, not a timer.
    await cardAfterReload.getByRole("button", { name: "Delete" }).click();
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (response: Response) =>
          /\/api\/flashcards\/[^/]+$/.test(response.url()) && response.request().method() === "DELETE",
      ),
      cardAfterReload.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(deleteResponse.status(), "delete request should succeed").toBe(204);
    await expect(cardAfterReload).toHaveCount(0);
  });
});
