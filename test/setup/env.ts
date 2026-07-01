import { vi } from "vitest";

// Integration tests expect TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, and
// TEST_SUPABASE_SERVICE_ROLE_KEY to be exported from the local Supabase env.
vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: process.env.TEST_OPENROUTER_API_KEY ?? "test-openrouter-key",
  SUPABASE_URL: process.env.TEST_SUPABASE_URL,
  SUPABASE_KEY: process.env.TEST_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
}));
