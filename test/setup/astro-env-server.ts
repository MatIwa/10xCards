// This module backs the `astro:env/server` alias in vitest.config.ts and is
// the single source of truth for env values inside tests. Individual tests
// can still override specific keys via `vi.mock("astro:env/server", ...)`
// (see src/lib/services/ai-generation.service.test.ts for the pattern).
//
// Integration tests expect TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, and
// TEST_SUPABASE_SERVICE_ROLE_KEY to be exported from the local Supabase env.
export const OPENROUTER_API_KEY = process.env.TEST_OPENROUTER_API_KEY ?? "test-openrouter-key";
export const OPENROUTER_MODEL = process.env.TEST_OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";
export const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
export const SUPABASE_KEY = process.env.TEST_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
