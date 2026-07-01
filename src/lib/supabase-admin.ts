import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

function getServerEnvValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createAdminClient(): SupabaseClient | null {
  const supabaseUrl = getServerEnvValue(SUPABASE_URL);
  const serviceRoleKey = getServerEnvValue(SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
