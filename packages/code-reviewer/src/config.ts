import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

try {
  process.loadEnvFile();
} catch {
  // No .env file found; rely on the ambient environment instead.
}

export const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5"),
});

export type AppEnv = z.infer<typeof envSchema>;

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
