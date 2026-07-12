// Provenance: E2E for Risk #6 in context/foundation/test-plan.md
//   "FSRS wiring mistake — recall rating maps to the wrong next-due state, or
//    the write-back targets the wrong card/user → PRD guardrail broken
//    ('SR reviews must never lose progress or show the wrong card')."
//
// Modeled on the seed exemplar (test/e2e/seed.spec.ts).
//
// The unit + integration tests in test-plan §6.5 protect the service-side
// wiring (which arguments reach ts-fsrs, that the persisted state equals the
// scheduler's return unchanged). What integration cannot cover is the browser
// boundary: does the click on a rating button in the review UI actually POST
// the right rating to /api/flashcards/{id}/review, and does the response
// carry an updated card back? This test smokes that surface end-to-end.
//
// Queue-order caveat
// ------------------
// The E2E user is shared across specs (storageState) and the review queue is
// ordered by `due asc`; we cannot assume the seeded card is the FIRST card in
// the session. The risk-defining oracle here is therefore NOT the identity of
// the rated card — that belongs to the integration test — but the wiring:
//   - The rating button click triggers exactly one POST to /api/flashcards/{uuid}/review
//   - The request body carries the correct rating for the button pressed
//   - The response carries a card with FSRS state that ADVANCED from the
//     pre-review baseline (reps > 0, last_review set)
// That combination fails if the buttons are un-wired, wired to the wrong
// URL/rating, or if the server no longer persists the scheduler output.
//
// Real vs mocked boundaries
// -------------------------
// Real: auth cookie, Astro SSR, POST /api/flashcards, POST /api/flashcards/{id}/review,
// ts-fsrs, Supabase, RLS. Nothing external — no LLM call — so nothing is mocked.

import { randomUUID } from "node:crypto";
import type { Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

const REVIEW_URL_PATTERN = /\/api\/flashcards\/[0-9a-f-]{36}\/review$/;

test.describe("Risk #6 — FSRS review wiring: rating in the UI persists advanced state to the DB", () => {
  test("clicking Good after Show answer submits POST /api/flashcards/{id}/review with rating=3 and the response reflects the scheduler passthrough", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Unique per run so parallel workers and re-runs against the same Supabase
    // instance cannot collide, and so cleanup by-id finds exactly our row.
    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const seedFront = `FSRS wiring seed front ${runId}`;
    const seedBack = `FSRS wiring seed back ${runId}`;

    // SEED: create a card via the app's own POST /api/flashcards. Newly-created
    // cards have reps=0, last_review=null, due=now → they enter the "due"
    // review queue immediately. Using in-browser fetch (not page.request) so
    // the request carries the same session cookie the UI would send — see the
    // Risk #2 spec's cleanup for the same rationale.
    //
    // page.evaluate resolves relative URLs against the current page origin, so
    // we visit /dashboard first to establish it. This also confirms the auth
    // cookie is live before we exercise the API.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const seed = await page.evaluate(
      async ({ front, back }) => {
        const response = await fetch("/api/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ front, back, source: "manual" }),
        });
        const payload = (await response.json()) as { data: { id: string; reps: number; last_review: string | null } };
        return { status: response.status, data: payload.data };
      },
      { front: seedFront, back: seedBack },
    );
    expect(seed.status, "seed card should be created successfully").toBe(201);
    expect(seed.data.reps, "new card starts with reps=0").toBe(0);
    expect(seed.data.last_review, "new card has no prior review").toBeNull();
    const seedId = seed.data.id;

    try {
      // PLAN step 1: enter the review session. Wait for the "Show answer"
      // button to be visible — that proves the queue loaded with at least one
      // card (state), not a time wait.
      await page.goto("/dashboard/review");
      await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
      const showAnswerButton = page.getByRole("button", { name: "Show answer" });
      await expect(showAnswerButton, "the seeded due card is visible in the queue").toBeVisible();

      // PLAN step 2: reveal the answer. Wait on state — the four rating
      // buttons must appear before we can click Good. Each rating button's
      // accessible name embeds the FSRS-computed preview interval
      // ("Good in 10 minutes", "Easy in 7 days", …) which is card-dependent,
      // so we anchor by the leading rating word via regex — never by the
      // interval, which would flake as the scheduler math evolves.
      await showAnswerButton.click();
      const goodButton = page.getByRole("button", { name: /^Good\b/ });
      await expect(goodButton, "the four rating buttons appear after Show answer").toBeVisible();

      // PLAN step 3 (risk-defining check): click Good and capture the round-trip.
      // The assertion set here fails if:
      //   - the rating button isn't wired to POST anywhere
      //     (waitForResponse timeout);
      //   - the URL is wrong or missing the card id (regex mismatch);
      //   - the request body carries the wrong rating
      //     (rating=3 <=> "Good" — this is the label→number mapping the wiring
      //     owns);
      //   - the server doesn't call ts-fsrs or doesn't persist its output
      //     (reps stays 0, last_review stays null).
      const [reviewResponse] = await Promise.all([
        page.waitForResponse(
          (response: Response) => REVIEW_URL_PATTERN.test(response.url()) && response.request().method() === "POST",
        ),
        goodButton.click(),
      ]);
      expect(reviewResponse.status(), "grade request should succeed").toBe(200);
      expect(reviewResponse.request().postDataJSON(), "Good must map to rating=3 in the request body").toMatchObject({
        rating: 3,
      });

      const responseBody = (await reviewResponse.json()) as {
        data: {
          id: string;
          reps: number;
          last_review: string | null;
          state: number;
        };
      };
      const card = responseBody.data;
      expect(card.id, "response carries the id of the card that was rated").toMatch(/^[0-9a-f-]{36}$/);
      expect(
        card.reps,
        "reps must advance (was 0 if the rated card is our seed, ≥1 for any card ts-fsrs saw) — a 0 here means the scheduler ran but nothing was persisted, i.e. the write-back is broken",
      ).toBeGreaterThanOrEqual(1);
      const lastReview = card.last_review;
      expect(
        lastReview,
        "last_review must be set to a real ISO timestamp — null here means the write-back did not touch the timestamp column",
      ).not.toBeNull();
      if (lastReview === null) {
        throw new Error("unreachable: last_review null-check above must have failed the test first");
      }
      expect(new Date(lastReview).getTime(), "last_review must be a parseable ISO timestamp").not.toBeNaN();
      expect(
        card.state,
        "state must be a valid FSRS state (0=New, 1=Learning, 2=Review, 3=Relearning)",
      ).toBeGreaterThanOrEqual(0);
      expect(card.state).toBeLessThanOrEqual(3);
    } finally {
      // CLEANUP: delete the seeded card via the same in-browser fetch pattern.
      // Fires regardless of assertion failure so the shared E2E user's deck
      // never leaks fixture rows from run to run.
      await page.evaluate(async (flashcardId) => {
        await fetch(`/api/flashcards/${flashcardId}`, { method: "DELETE" });
      }, seedId);
    }
  });
});
