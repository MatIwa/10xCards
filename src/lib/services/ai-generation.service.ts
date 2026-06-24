import { OPENROUTER_API_KEY } from "astro:env/server";
import { modelOutputSchema, type Proposal } from "@/lib/schemas/ai-generation.schemas";

type GenerationErrorCode = "missing_api_key" | "provider_unavailable" | "invalid_model_output" | "empty_result";

export interface GenerationError {
  code: GenerationErrorCode;
  message: string;
}

export type GenerateResult = { data: Proposal[]; error: null } | { data: null; error: GenerationError };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Swapped from the planned `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` to this lighter
// free-tier model after the original proved unreliable on OpenRouter during implementation.
// See the addendum at the bottom of `context/changes/ai-flashcard-generation/plan.md` and the
// Phase 1 note in `context/changes/ai-flashcard-generation/change.md`.
const MODEL_ID = "liquid/lfm-2.5-1.2b-instruct:free";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 2500;

const SYSTEM_PROMPT = `You generate flashcards from study material. Read the user's text and extract up to 15 testable knowledge units as question/answer pairs.

Output rules (strict):
- Respond with JSON only. No prose, no markdown, no code fences, no preamble, no trailing commentary.
- Schema: {"cards": [{"front": string, "back": string}, ...]}
- front: a concise question or prompt, at most 1000 characters.
- back: a complete, self-contained answer, at most 5000 characters.
- 1 to 15 cards. Quality over quantity; skip filler facts.
- Write cards in the same language as the source text.
- Do not invent facts not present in the source. If the source has no testable content, return {"cards": []}.`;

interface OpenRouterResponse {
  choices?: {
    message?: {
      content?: unknown;
    };
  }[];
}

function generationError(code: GenerationErrorCode, message: string): GenerationError {
  return { code, message };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fetchOpenRouter(sourceText: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_ID,
        temperature: 0.1,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: sourceText },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseModelContent(responseBody: OpenRouterResponse): unknown {
  const content = responseBody.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

export async function generateProposals(sourceText: string): Promise<GenerateResult> {
  if (!OPENROUTER_API_KEY) {
    return { data: null, error: generationError("missing_api_key", "AI generation is not configured") };
  }

  let response: Response;
  try {
    response = await fetchOpenRouter(sourceText);
  } catch (error) {
    const message = isAbortError(error) ? "The AI service timed out" : "The AI service is temporarily unavailable";
    return { data: null, error: generationError("provider_unavailable", message) };
  }

  if (!response.ok) {
    return { data: null, error: generationError("provider_unavailable", "The AI service is temporarily unavailable") };
  }

  let responseBody: OpenRouterResponse;
  try {
    responseBody = (await response.json()) as OpenRouterResponse;
  } catch {
    return { data: null, error: generationError("invalid_model_output", "The AI response could not be parsed") };
  }

  const parsedContent = parseModelContent(responseBody);
  const parsedOutput = modelOutputSchema.safeParse(parsedContent);
  if (!parsedOutput.success) {
    return {
      data: null,
      error: generationError("invalid_model_output", "The AI response was not in the expected format"),
    };
  }

  if (parsedOutput.data.cards.length === 0) {
    return { data: null, error: generationError("empty_result", "The AI did not find testable content in this text") };
  }

  return {
    data: parsedOutput.data.cards.map((card) => ({
      id: crypto.randomUUID(),
      front: card.front,
      back: card.back,
    })),
    error: null,
  };
}
