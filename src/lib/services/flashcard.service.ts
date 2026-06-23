import type { SupabaseClient } from "@supabase/supabase-js";
import type { Flashcard } from "@/types";
import type { CreateFlashcardInput, UpdateFlashcardInput } from "@/lib/schemas/flashcard.schemas";

interface DataResult<T> {
  data: T | null;
  error: string | null;
}

interface ErrorResult {
  error: string | null;
}

export async function listFlashcards(supabase: SupabaseClient): Promise<DataResult<Flashcard[]>> {
  const response = await supabase.from("flashcards").select("*").order("created_at", { ascending: false });

  if (response.error) {
    return { data: null, error: response.error.message };
  }

  return { data: response.data as Flashcard[], error: null };
}

export async function createFlashcard(
  supabase: SupabaseClient,
  input: CreateFlashcardInput,
  userId: string,
): Promise<DataResult<Flashcard>> {
  const response = await supabase
    .from("flashcards")
    .insert({
      user_id: userId,
      front: input.front,
      back: input.back,
      source: input.source,
    })
    .select("*")
    .single();

  if (response.error) {
    return { data: null, error: response.error.message };
  }

  return { data: response.data as Flashcard, error: null };
}

export async function updateFlashcard(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  input: UpdateFlashcardInput,
): Promise<DataResult<Flashcard>> {
  const response = await supabase
    .from("flashcards")
    .update(input)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (response.error) {
    return { data: null, error: response.error.message };
  }

  if (!response.data) {
    return { data: null, error: "Flashcard not found" };
  }

  return { data: response.data as Flashcard, error: null };
}

export async function deleteFlashcard(supabase: SupabaseClient, id: string, userId: string): Promise<ErrorResult> {
  const response = await supabase.from("flashcards").delete({ count: "exact" }).eq("id", id).eq("user_id", userId);

  if (response.error) {
    return { error: response.error.message };
  }

  if (!response.count) {
    return { error: "Flashcard not found" };
  }

  return { error: null };
}
