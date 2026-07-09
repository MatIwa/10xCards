import type { APIContext } from "astro";
import { randomUUID } from "node:crypto";
import { Rating } from "ts-fsrs";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "@/middleware";
import { POST } from "@/pages/api/flashcards/[id]/review";
import { GET } from "@/pages/api/flashcards/review/queue";
import type { Flashcard } from "@/types";

import { readFlashcardById, resetFlashcards } from "../helpers/db";
import { createIntegrationUser } from "../helpers/integration-user";
import { createCookieSink, invokeApiRoute } from "../helpers/invoke-api-route";

type IntegrationUser = Awaited<ReturnType<typeof createIntegrationUser>>;
type IntegrationSession = Awaited<ReturnType<IntegrationUser["signIn"]>>;

interface ReviewResponse {
  data: Flashcard | null;
  skipped?: boolean;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for integration tests`);
  return value;
}

function createServiceRoleClient() {
  return createClient(getRequiredEnv("TEST_SUPABASE_URL"), getRequiredEnv("TEST_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function insertFlashcard(userId: string, label: string, pastDue = true) {
  const supabase = createServiceRoleClient();
  const due = pastDue
    ? new Date(Date.now() - 86_400_000).toISOString()
    : new Date(Date.now() + 86_400_000).toISOString();

  const { data, error } = (await supabase
    .from("flashcards")
    .insert({
      user_id: userId,
      front: `${label} front`,
      back: `${label} back`,
      source: "manual",
      due,
    })
    .select("*")
    .maybeSingle()) as { data: Flashcard | null; error: { message: string } | null };

  if (error) throw new Error(error.message);
  if (!data) throw new Error("insertFlashcard returned null");
  return data;
}

describe("review service integration", () => {
  let actorUser: IntegrationUser;
  let otherUser: IntegrationUser;
  let actorSession: IntegrationSession;

  beforeEach(async () => {
    actorUser = await createIntegrationUser({ emailPrefix: `review-actor-${randomUUID()}` });
    otherUser = await createIntegrationUser({ emailPrefix: `review-other-${randomUUID()}` });
    await Promise.all([resetFlashcards(actorUser.userId), resetFlashcards(otherUser.userId)]);
    actorSession = await actorUser.signIn();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([resetFlashcards(actorUser.userId), resetFlashcards(otherUser.userId)]);
  });

  it("grades a card and persists FSRS state change", async () => {
    const card = await insertFlashcard(actorUser.userId, "grade-test");
    const before = await readFlashcardById(card.id);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: `/api/flashcards/${card.id}/review`,
      params: { id: card.id },
      session: actorSession,
      body: { rating: Rating.Good },
      handler: POST,
    });
    const body = (await response.json()) as ReviewResponse;

    expect(response.status).toBe(200);
    expect(body.data?.id).toBe(card.id);

    const after = await readFlashcardById(card.id);
    // At least one FSRS field must have changed (scheduler ran and was persisted)
    const changed =
      after?.reps !== before?.reps ||
      after?.stability !== before?.stability ||
      after?.difficulty !== before?.difficulty ||
      after?.last_review !== before?.last_review ||
      after?.due !== before?.due;
    expect(changed).toBe(true);
    expect(after?.updated_at).not.toBe(before?.updated_at);
  });

  it("returns skipped: true for practice: true and does not mutate the row", async () => {
    const card = await insertFlashcard(actorUser.userId, "practice-test");
    const before = await readFlashcardById(card.id);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: `/api/flashcards/${card.id}/review`,
      params: { id: card.id },
      session: actorSession,
      body: { rating: Rating.Good, practice: true },
      handler: POST,
    });
    const body = (await response.json()) as ReviewResponse;

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: null, skipped: true });

    const after = await readFlashcardById(card.id);
    // Row must be byte-identical
    expect(after?.reps).toBe(before?.reps);
    expect(after?.stability).toBe(before?.stability);
    expect(after?.difficulty).toBe(before?.difficulty);
    expect(after?.last_review).toBe(before?.last_review);
    expect(after?.due).toBe(before?.due);
  });

  it("returns 404 when grading another user's card and leaves it unchanged", async () => {
    const otherCard = await insertFlashcard(otherUser.userId, "other-card");
    const before = await readFlashcardById(otherCard.id);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: `/api/flashcards/${otherCard.id}/review`,
      params: { id: otherCard.id },
      session: actorSession,
      body: { rating: Rating.Good },
      handler: POST,
    });
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Flashcard not found" });

    const after = await readFlashcardById(otherCard.id);
    expect(after?.reps).toBe(before?.reps);
    expect(after?.stability).toBe(before?.stability);
    expect(after?.due).toBe(before?.due);
  });

  it("returns 401 when grading without a session", async () => {
    const card = await insertFlashcard(actorUser.userId, "unauth-test");

    const response = await invokeApiRoute({
      method: "POST",
      pathname: `/api/flashcards/${card.id}/review`,
      params: { id: card.id },
      body: { rating: Rating.Good },
      handler: POST,
    });
    const body2 = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body2).toEqual({ error: "Unauthorized" });
  });

  it("queue returns only actor's due cards and excludes other user's cards", async () => {
    // Seed 1 past-due card for actor and 3 for other
    await insertFlashcard(actorUser.userId, "actor-due");
    await insertFlashcard(otherUser.userId, "other-1");
    await insertFlashcard(otherUser.userId, "other-2");
    await insertFlashcard(otherUser.userId, "other-3");

    const response = await invokeApiRoute({
      method: "GET",
      pathname: "/api/flashcards/review/queue?mode=due",
      session: actorSession,
      handler: GET,
    });
    const body = (await response.json()) as { data: (Flashcard & { preview: unknown })[] };

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data.every((card) => card.user_id === actorUser.userId)).toBe(true);
  });

  it("queue returns 401 from middleware when unauthenticated", async () => {
    const next = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const context = {
      request: new Request("http://localhost/api/flashcards/review/queue"),
      url: new URL("http://localhost/api/flashcards/review/queue"),
      cookies: createCookieSink(),
      locals: {},
    } as unknown as APIContext;

    const response = await onRequest(context, next);

    expect(response).toBeInstanceOf(Response);
    const middlewareResponse = response as Response;
    expect(middlewareResponse.status).toBe(401);
    expect(await middlewareResponse.json()).toEqual({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});
