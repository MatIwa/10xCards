import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

describe("local Supabase integration harness", () => {
  it("can query the flashcards table", async () => {
    const supabaseUrl = process.env.TEST_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

    expect(supabaseUrl).toBeTruthy();
    expect(supabaseServiceRoleKey).toBeTruthy();

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing local Supabase test env vars");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { error } = await supabase.from("flashcards").select("id").limit(1);

    expect(error).toBeNull();
  });
});
