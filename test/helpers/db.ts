import { createClient } from "@supabase/supabase-js";
import type { Flashcard } from "@/types";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} for integration tests`);
  }

  return value;
}

function createServiceRoleClient() {
  return createClient(getRequiredEnv("TEST_SUPABASE_URL"), getRequiredEnv("TEST_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function resetFlashcards(userId: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("flashcards").delete().eq("user_id", userId);

  if (error) {
    throw error;
  }
}

export async function readFlashcards(userId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data as Flashcard[];
}
