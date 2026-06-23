import { z } from "zod";
import type { FlashcardSource } from "@/types";

const flashcardSourceValues = ["manual", "ai_full", "ai_edited"] as const satisfies readonly FlashcardSource[];

const frontSchema = z.string().trim().min(1, "Front is required").max(1000, "Front must be 1000 characters or fewer");

const backSchema = z.string().trim().min(1, "Back is required").max(5000, "Back must be 5000 characters or fewer");

export const createFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
  source: z.enum(flashcardSourceValues).default("manual"),
});

export const updateFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
});

export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;
export type UpdateFlashcardInput = z.infer<typeof updateFlashcardSchema>;
