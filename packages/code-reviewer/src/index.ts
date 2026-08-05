import { LlmAgent } from "@google/adk";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// Load .env into process.env if present (Node >=20.12 built-in; no dependency needed).
try {
  process.loadEnvFile();
} catch {
  // No .env file found; rely on the ambient environment instead.
}

export const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5"),
  ADK_AGENT_NAME: z.string().default("code-reviewer"),
  ADK_AGENT_DESCRIPTION: z.string().default("Base ADK agent prepared for future Code Reviewer integration."),
  ADK_AGENT_INSTRUCTION: z.string().default("You are a helpful coding assistant. Keep answers precise and actionable."),
});

export const promptSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
});

export type AppEnv = z.infer<typeof envSchema>;
export type PromptInput = z.infer<typeof promptSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function createOpenRouterClient(overrides: Partial<AppEnv> = {}) {
  const env = envSchema.parse({ ...process.env, ...overrides });

  return {
    env,
    openrouter: createOpenRouter({
      apiKey: env.OPENROUTER_API_KEY,
    }),
  };
}

export function createRootAgent(overrides: Partial<AppEnv> = {}) {
  const env = envSchema.parse({ ...process.env, ...overrides });

  return new LlmAgent({
    name: env.ADK_AGENT_NAME,
    description: env.ADK_AGENT_DESCRIPTION,
    instruction: env.ADK_AGENT_INSTRUCTION,
    model: env.OPENROUTER_MODEL,
  });
}

export async function generateStarterResponse(input: PromptInput | string, overrides: Partial<AppEnv> = {}) {
  const { env, openrouter } = createOpenRouterClient(overrides);
  const { prompt } = typeof input === "string" ? promptSchema.parse({ prompt: input }) : promptSchema.parse(input);

  const result = await generateText({
    model: openrouter(env.OPENROUTER_MODEL),
    prompt,
  });

  return result.text;
}

export async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (!prompt) {
    process.stderr.write('Usage: npm run dev -- "Your prompt here"\n');
    process.exitCode = 1;
    return;
  }

  const text = await generateStarterResponse(prompt);
  process.stdout.write(`${text}\n`);
}

// Node 22 lacks import.meta.main; compare the resolved entry URL instead.
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isDirectRun) {
  void main();
}
