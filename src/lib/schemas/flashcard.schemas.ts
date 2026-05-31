import { z } from "zod";

const frontSchema = z.string().trim().min(1, "Front is required").max(1000, "Front must be 1000 characters or fewer");

const backSchema = z.string().trim().min(1, "Back is required").max(5000, "Back must be 5000 characters or fewer");

export const createFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
});

export const updateFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
});

export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;
export type UpdateFlashcardInput = z.infer<typeof updateFlashcardSchema>;
