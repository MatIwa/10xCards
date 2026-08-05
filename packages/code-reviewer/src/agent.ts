import { Output, ToolLoopAgent } from "ai";

import { createOpenRouterClient, type AppEnv } from "./config.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt } from "./prompts/review.js";
import { reviewInputSchema, reviewOutputSchema, type ReviewInput, type ReviewOutput } from "./schemas/review.js";

const MAX_REVIEW_ATTEMPTS = 3;

function createTypedReviewer(overrides: Partial<AppEnv> = {}) {
  const { env, openrouter } = createOpenRouterClient(overrides);

  return new ToolLoopAgent({
    model: openrouter(env.OPENROUTER_MODEL),
    instructions: REVIEW_SYSTEM_PROMPT,
    tools: {},
    output: Output.object({ schema: reviewOutputSchema }),
  });
}

export function createReviewer(overrides: Partial<AppEnv> = {}): ToolLoopAgent {
  return createTypedReviewer(overrides);
}

export async function reviewDiff(input: ReviewInput | string, overrides: Partial<AppEnv> = {}): Promise<ReviewOutput> {
  const parsed = typeof input === "string" ? reviewInputSchema.parse({ diff: input }) : reviewInputSchema.parse(input);
  const prompt = buildReviewPrompt(parsed);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      const agent = createTypedReviewer(overrides);
      const result = await agent.generate({ prompt });

      return reviewOutputSchema.parse(result.output);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Review failed after multiple attempts");
}
