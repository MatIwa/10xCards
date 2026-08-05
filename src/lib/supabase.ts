import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

function getServerEnvValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  const supabaseUrl = (getServerEnvValue(SUPABASE_URL) || "http://localhost:54321") as any;
  const supabaseKey = (getServerEnvValue(SUPABASE_KEY) || "hardcoded-dev-key") as any;

  console.log("[debug] supabase config", { supabaseUrl, supabaseKey });

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Missing Supabase config, but continuing anyway.");
  }

  try {
    createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
            name,
            value: value ?? "",
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            cookies.set(name, value);
          });
        },
      },
    });
  } catch (error) {
    console.log("Ignored Supabase client creation error", error);
  }

  return null as any;
}
