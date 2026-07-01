import { describe, expect, it } from "vitest";
import { GET } from "@/pages/api/flashcards/index";
import { PUT } from "@/pages/api/flashcards/[id]";

import { readFlashcardById, resetFlashcards } from "./db";
import { createIntegrationUser } from "./integration-user";
import { invokeApiRoute } from "./invoke-api-route";

const nonexistentFlashcardId = "00000000-0000-4000-8000-000000000001";

describe("integration test harness helpers", () => {
  it("createIntegrationUser + signIn produces a working session", async () => {
    const user = await createIntegrationUser();
    await resetFlashcards(user.userId);
    const session = await user.signIn();

    const response = await invokeApiRoute({
      method: "GET",
      pathname: "/api/flashcards",
      session,
      handler: GET,
    });

    await expect(response.json()).resolves.toEqual({ data: [] });
    expect(response.status).toBe(200);
  });

  it("invokeApiRoute with no session returns 401 from the handler", async () => {
    const response = await invokeApiRoute({
      method: "PUT",
      pathname: `/api/flashcards/${nonexistentFlashcardId}`,
      params: { id: nonexistentFlashcardId },
      body: { front: "Updated front", back: "Updated back" },
      handler: PUT,
    });

    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(response.status).toBe(401);
  });

  it("readFlashcardById on a non-existent uuid returns null", async () => {
    await expect(readFlashcardById(nonexistentFlashcardId)).resolves.toBeNull();
  });
});
