export type FlashcardSource = "manual" | "ai_full" | "ai_edited";

export interface Flashcard {
  id: string;
  user_id: string;
  front: string;
  back: string;
  source: FlashcardSource;
  interval: number;
  ease_factor: number;
  repetitions: number;
  next_review_at: string;
  created_at: string;
  updated_at: string;
}
