export type FlashcardSource = "manual" | "ai_full" | "ai_edited";

export interface Flashcard {
  id: string;
  user_id: string;
  front: string;
  back: string;
  source: FlashcardSource;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;
  last_review: string | null;
  created_at: string;
  updated_at: string;
}
