import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted<{ openrouterApiKey: string | undefined }>(() => ({
  openrouterApiKey: "test-openrouter-key",
}));

vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() {
    return envMock.openrouterApiKey;
  },
}));

const sourceText =
  "This is a deliberately long source text for the AI generation parser contract test. It contains enough characters to represent a realistic pasted lesson excerpt without depending on a real provider response. The exact content is not important; the schema-derived fixture data below is the oracle.";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openRouterResponse(content: unknown): Response {
  return Response.json({
    choices: [
      {
        message: { content },
      },
    ],
  });
}

function modelContent(cards: unknown): string {
  return JSON.stringify({ cards });
}

async function importService() {
  return import("./ai-generation.service");
}

describe("generateProposals", () => {
  beforeEach(() => {
    vi.resetModules();
    envMock.openrouterApiKey = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns typed proposals for a valid model response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "P1-front", back: "P1-back" }])));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({ front: "P1-front", back: "P1-back" });
    expect(result.data?.[0]?.id).toMatch(uuidPattern);
  });

  it("limits model responses to 15 proposals", async () => {
    const fetchMock = vi.mocked(fetch);
    const cards = Array.from({ length: 20 }, (_, index) => ({
      front: `P${index + 1}-front`,
      back: `P${index + 1}-back`,
    }));
    fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent(cards)));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(15);
    expect(result.data?.at(-1)).toMatchObject({ front: "P15-front", back: "P15-back" });
  });

  it("returns invalid_model_output for malformed JSON content", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse("not-json {["));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_model_output");
  });

  it("returns invalid_model_output for a response missing cards", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse(JSON.stringify({ items: [] })));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_model_output");
  });

  it("returns invalid_model_output for a schema-drifted card missing back", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "question" }])));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_model_output");
  });

  it("returns invalid_model_output when a card back is too long", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent([{ front: "question", back: "x".repeat(5001) }])));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_model_output");
  });

  it("returns empty_result when the model returns no cards", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse(modelContent([])));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("empty_result");
  });

  it("returns invalid_model_output for non-string content", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(openRouterResponse({ cards: [] }));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_model_output");
  });

  it("returns provider_unavailable for non-200 provider responses", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 502 }));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("provider_unavailable");
  });

  it("returns provider_unavailable with a timeout message for AbortError", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("provider_unavailable");
    expect(result.error?.message).toContain("timed out");
  });

  it("returns provider_unavailable for generic fetch errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("provider_unavailable");
  });

  it("returns missing_api_key without calling fetch when the API key is absent", async () => {
    const fetchMock = vi.mocked(fetch);
    envMock.openrouterApiKey = undefined;
    const { generateProposals } = await importService();

    const result = await generateProposals(sourceText);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("missing_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
