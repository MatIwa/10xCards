import type { SupabaseClient } from "@supabase/supabase-js";
import { fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import type { Flashcard } from "@/types";

export interface DataResult<T> {
  data: T | null;
  error: string | null;
}

export interface RatingPreview {
  again: Date;
  hard: Date;
  good: Date;
  easy: Date;
}

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true });

export function rehydrate(row: Flashcard): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function serialize(card: Card): Partial<Flashcard> {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- The current flashcards schema stores this ts-fsrs field.
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.toISOString() ?? null,
  };
}

export async function listDueCards(supabase: SupabaseClient): Promise<DataResult<Flashcard[]>> {
  const response = await supabase
    .from("flashcards")
    .select("*")
    .lte("due", new Date().toISOString())
    .order("due", { ascending: true });

  if (response.error) {
    return { data: null, error: response.error.message };
  }

  return { data: response.data as Flashcard[], error: null };
}

export async function listPracticeCards(supabase: SupabaseClient, limit = 20): Promise<DataResult<Flashcard[]>> {
  const response = await supabase
    .from("flashcards")
    .select("*")
    .order("last_review", { ascending: true, nullsFirst: false })
    .order("due", { ascending: true })
    .limit(limit);

  if (response.error) {
    return { data: null, error: response.error.message };
  }

  return { data: response.data as Flashcard[], error: null };
}

export function previewRatings(row: Flashcard, now = new Date()): RatingPreview {
  const preview = scheduler.repeat(rehydrate(row), now);

  return {
    again: preview[Rating.Again].card.due,
    hard: preview[Rating.Hard].card.due,
    good: preview[Rating.Good].card.due,
    easy: preview[Rating.Easy].card.due,
  };
}

export async function gradeCard(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  rating: Rating,
): Promise<DataResult<Flashcard>> {
  const existing = await supabase.from("flashcards").select("*").eq("id", id).eq("user_id", userId).maybeSingle();

  if (existing.error) {
    return { data: null, error: existing.error.message };
  }

  if (!existing.data) {
    return { data: null, error: "Flashcard not found" };
  }

  const { card } = scheduler.next(rehydrate(existing.data as Flashcard), new Date(), rating as Grade);
  const response = await supabase
    .from("flashcards")
    .update(serialize(card))
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
