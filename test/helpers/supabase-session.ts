import { createClient } from "@supabase/supabase-js";

import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from "./integration-user";

interface SignInCredentials {
  email: string;
  password: string;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} for integration tests`);
  }

  return value;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getSupabaseAuthCookieName(supabaseUrl: string) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

export async function signInTestUser() {
  return signInUser({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
}

export async function signInUser({ email, password }: SignInCredentials) {
  const supabaseUrl = getRequiredEnv("TEST_SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("TEST_SUPABASE_ANON_KEY");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const cookieName = getSupabaseAuthCookieName(supabaseUrl);
  const cookieValue = `base64-${toBase64Url(JSON.stringify(data.session))}`;

  return {
    userId: data.user.id,
    cookieHeader: `${cookieName}=${cookieValue}`,
  };
}
