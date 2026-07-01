import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

function getServerEnvValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  const supabaseUrl = getServerEnvValue(SUPABASE_URL);
  const supabaseKey = getServerEnvValue(SUPABASE_KEY);
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}
