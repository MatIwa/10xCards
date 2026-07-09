import { randomUUID } from "node:crypto";
import type { Mock, MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/flashcards/generate";

import { readFlashcards, resetFlashcards } from "../helpers/db";
import { createIntegrationUser } from "../helpers/integration-user";
import { invokeApiRoute } from "../helpers/invoke-api-route";

const envMock = vi.hoisted<{ openrouterApiKey: string | undefined }>(() => ({
  openrouterApiKey: "test-openrouter-key",
}));

vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() {
    return envMock.openrouterApiKey;
  },
  get SUPABASE_URL() {
    return process.env.TEST_SUPABASE_URL;
  },
  get SUPABASE_KEY() {
    return process.env.TEST_SUPABASE_ANON_KEY;
  },
}));

function openRouterResponse(content: unknown): Response {
  return Response.json({
    choices: [{ message: { content } }],
  });
}

function modelContent(cards: unknown): string {
  return JSON.stringify({ cards });
}

const VALID_SOURCE = "a".repeat(200);
type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("POST /api/flashcards/generate", () => {
  let user: Awaited<ReturnType<typeof createIntegrationUser>>;
  let errorSpy: MockInstance<typeof console.error>;
  let openRouterFetch: Mock<ProviderFetch>;

  beforeEach(async () => {
    user = await createIntegrationUser({ emailPrefix: `generate-${randomUUID()}` });
    envMock.openrouterApiKey = "test-openrouter-key";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await resetFlashcards(user.userId);
    const originalFetch = globalThis.fetch.bind(globalThis);
    openRouterFetch = vi.fn<ProviderFetch>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith(process.env.TEST_SUPABASE_URL ?? "")) {
        const response = await originalFetch(input, init);
        return response;
      }

      const response = await openRouterFetch(input, init);
      return response;
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    await resetFlashcards(user.userId);
  });

  describe("input validation contract (Risk #7)", () => {
    it("rejects missing source_text field with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: {},
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("rejects empty string source_text with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "" },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("rejects too-short source_text with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "a".repeat(199) },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("rejects too-long source_text with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "a".repeat(25001) },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("rejects wrong-type source_text with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: 123 },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("rejects non-object body with 400 before calling LLM", async () => {
      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: "just a string",
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(400);
      expect(openRouterFetch).not.toHaveBeenCalled();
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("accepts valid body with unknown keys stripped (records current .strip() behavior)", async () => {
      openRouterFetch.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "F", back: "B" }])));

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: VALID_SOURCE, stray: "value" },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });

      expect(response.status).toBe(200);
      expect(openRouterFetch).toHaveBeenCalledTimes(1);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });
  });

  describe("privacy / non-retention (Risk #4)", () => {
    function assertProbeAbsentFromConsoleCalls(probe: string) {
      for (const call of errorSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(probe);
      }
    }

    it("401 no-session: probe absent from response body and logs", async () => {
      const probe = randomUUID();

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(401);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("400 too-short: probe absent from response body and logs", async () => {
      const probe = randomUUID();

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "a" + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(400);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("400 wrong-type with probe in sibling key: probe absent from response body and logs", async () => {
      const probe = randomUUID();

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: 123, note: probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(400);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("502 provider non-ok: probe in provider dump not forwarded to client", async () => {
      const probe = randomUUID();
      openRouterFetch.mockResolvedValueOnce(new Response(`provider dump: ${probe}`, { status: 500 }));

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(502);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("502 provider malformed JSON: probe absent from response body and logs", async () => {
      const probe = randomUUID();
      openRouterFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(502);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("502 provider throws: probe in error not forwarded to client or logs", async () => {
      const probe = randomUUID();
      openRouterFetch.mockRejectedValueOnce(Object.assign(new Error(`boom ${probe}`), { name: "AbortError" }));

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(502);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("500 missing API key: probe absent from response body and logs", async () => {
      const probe = randomUUID();
      envMock.openrouterApiKey = undefined;
      vi.resetModules();
      const { POST: postWithoutKey } = await import("@/pages/api/flashcards/generate");

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: postWithoutKey,
      });
      const responseText = await response.text();

      expect(response.status).toBe(500);
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });

    it("200 happy path: probe absent from response, source text not persisted to DB", async () => {
      const probe = randomUUID();
      openRouterFetch.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "F", back: "B" }])));

      const response = await invokeApiRoute({
        method: "POST",
        pathname: "/api/flashcards/generate",
        body: { source_text: "L".repeat(200 - probe.length) + probe },
        session: { userId: user.userId, cookieHeader: "" },
        handler: POST,
      });
      const responseText = await response.text();

      expect(response.status).toBe(200);
      expect(responseText).toContain("F");
      expect(responseText).toContain("B");
      expect(responseText).not.toContain(probe);
      assertProbeAbsentFromConsoleCalls(probe);
      expect(await readFlashcards(user.userId)).toHaveLength(0);
    });
  });
});
