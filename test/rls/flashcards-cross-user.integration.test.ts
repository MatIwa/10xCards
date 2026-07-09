import type { APIContext } from "astro";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "@/middleware";
import { DELETE, PUT } from "@/pages/api/flashcards/[id]";
import { GET, POST } from "@/pages/api/flashcards/index";
import type { Flashcard } from "@/types";

import { readFlashcardById, resetFlashcards } from "../helpers/db";
import { createIntegrationUser } from "../helpers/integration-user";
import { createCookieSink, invokeApiRoute } from "../helpers/invoke-api-route";

type IntegrationUser = Awaited<ReturnType<typeof createIntegrationUser>>;
type IntegrationSession = Awaited<ReturnType<IntegrationUser["signIn"]>>;

interface FlashcardsResponse {
  data: Flashcard[];
}

interface FlashcardResponse {
  data: Flashcard;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} for integration tests`);
  }

  return value;
}

function createServiceRoleClient() {
  return createClient(getRequiredEnv("TEST_SUPABASE_URL"), getRequiredEnv("TEST_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function insertFlashcards(userId: string, count: number, label: string) {
  const supabase = createServiceRoleClient();
  const rows = Array.from({ length: count }, (_, index) => ({
    user_id: userId,
    front: `${label} front ${index + 1}`,
    back: `${label} back ${index + 1}`,
    source: "manual",
  }));

  const { data, error } = await supabase.from("flashcards").insert(rows).select("*");

  if (error) {
    throw error;
  }

  return data as Flashcard[];
}

async function expectJson(response: Response) {
  return response.json() as Promise<unknown>;
}

describe("flashcards cross-user isolation", () => {
  let actorUser: IntegrationUser;
  let otherUser: IntegrationUser;
  let actorSession: IntegrationSession;

  beforeEach(async () => {
    actorUser = await createIntegrationUser({ emailPrefix: `rls-actor-${randomUUID()}` });
    otherUser = await createIntegrationUser({ emailPrefix: `rls-other-${randomUUID()}` });
    await Promise.all([resetFlashcards(actorUser.userId), resetFlashcards(otherUser.userId)]);
    actorSession = await actorUser.signIn();
  });

  afterEach(async () => {
    await Promise.all([resetFlashcards(actorUser.userId), resetFlashcards(otherUser.userId)]);
  });

  it("GET /api/flashcards as actor returns only actor rows", async () => {
    await insertFlashcards(actorUser.userId, 2, "actor");
    const otherFlashcards = await insertFlashcards(otherUser.userId, 3, "other");
    const otherFlashcardIds = new Set(otherFlashcards.map((flashcard) => flashcard.id));

    const response = await invokeApiRoute({
      method: "GET",
      pathname: "/api/flashcards",
      session: actorSession,
      handler: GET,
    });
    const body = (await response.json()) as FlashcardsResponse;

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data.every((flashcard) => flashcard.user_id === actorUser.userId)).toBe(true);
    expect(body.data.some((flashcard) => otherFlashcardIds.has(flashcard.id))).toBe(false);
  });

  it("GET /api/flashcards unauthenticated returns 401 from middleware", async () => {
    const next = vi.fn(async () => new Response(null, { status: 200 }));
    const context = {
      request: new Request("http://localhost/api/flashcards"),
      url: new URL("http://localhost/api/flashcards"),
      cookies: createCookieSink(),
      locals: {},
    } as unknown as APIContext;

    const response = await onRequest(context, next);

    expect(response).toBeInstanceOf(Response);
    const middlewareResponse = response as Response;
    const body = await expectJson(middlewareResponse);

    expect(middlewareResponse.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("POST /api/flashcards drops user_id from body on spoof attempt", async () => {
    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/flashcards",
      session: actorSession,
      body: {
        front: "Spoofed front",
        back: "Spoofed back",
        source: "manual",
        user_id: otherUser.userId,
      },
      handler: POST,
    });
    const body = (await response.json()) as FlashcardResponse;
    const row = await readFlashcardById(body.data.id);

    expect(response.status).toBe(201);
    expect(body.data.user_id).toBe(actorUser.userId);
    expect(row?.user_id).toBe(actorUser.userId);
  });

  it("PUT /api/flashcards/[other id] as actor returns 404 and leaves the row unchanged", async () => {
    const [otherFlashcard] = await insertFlashcards(otherUser.userId, 1, "other");

    const response = await invokeApiRoute({
      method: "PUT",
      pathname: `/api/flashcards/${otherFlashcard.id}`,
      params: { id: otherFlashcard.id },
      session: actorSession,
      body: { front: "Updated front", back: "Updated back" },
      handler: PUT,
    });
    const row = await readFlashcardById(otherFlashcard.id);

    const body = await expectJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Flashcard not found" });
    expect(row?.front).toBe(otherFlashcard.front);
    expect(row?.back).toBe(otherFlashcard.back);
    expect(row?.updated_at).toBe(otherFlashcard.updated_at);
  });

  it("DELETE /api/flashcards/[other id] as actor returns 404 and leaves the row present", async () => {
    const [otherFlashcard] = await insertFlashcards(otherUser.userId, 1, "other");

    const response = await invokeApiRoute({
      method: "DELETE",
      pathname: `/api/flashcards/${otherFlashcard.id}`,
      params: { id: otherFlashcard.id },
      session: actorSession,
      handler: DELETE,
    });
    const row = await readFlashcardById(otherFlashcard.id);

    const body = await expectJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Flashcard not found" });
    expect(row).not.toBeNull();
  });

  it("PUT /api/flashcards/[nonexistent uuid] as actor returns 404", async () => {
    const nonexistentFlashcardId = randomUUID();

    const response = await invokeApiRoute({
      method: "PUT",
      pathname: `/api/flashcards/${nonexistentFlashcardId}`,
      params: { id: nonexistentFlashcardId },
      session: actorSession,
      body: { front: "Updated front", back: "Updated back" },
      handler: PUT,
    });

    const body = await expectJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Flashcard not found" });
  });

  it("DELETE /api/flashcards/[nonexistent uuid] as actor returns 404", async () => {
    const nonexistentFlashcardId = randomUUID();

    const response = await invokeApiRoute({
      method: "DELETE",
      pathname: `/api/flashcards/${nonexistentFlashcardId}`,
      params: { id: nonexistentFlashcardId },
      session: actorSession,
      handler: DELETE,
    });

    const body = await expectJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Flashcard not found" });
  });

  it("POST /api/flashcards unauthenticated returns 401 from handler", async () => {
    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/flashcards",
      body: { front: "Unauth front", back: "Unauth back", source: "manual" },
      handler: POST,
    });

    const body = await expectJson(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
