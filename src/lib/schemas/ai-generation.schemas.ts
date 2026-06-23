import { z } from "zod";

const generatedFrontSchema = z
  .string()
  .trim()
  .min(1, "Front is required")
  .max(1000, "Front must be 1000 characters or fewer");

const generatedBackSchema = z
  .string()
  .trim()
  .min(1, "Back is required")
  .max(5000, "Back must be 5000 characters or fewer");

export const generateFlashcardsSchema = z.object({
  source_text: z
    .string()
    .trim()
    .min(200, "Source text must be at least 200 characters")
    .max(25000, "Source text must be 25,000 characters or fewer"),
});

export const modelOutputSchema = z.object({
  cards: z
    .array(
      z.object({
        front: generatedFrontSchema,
        back: generatedBackSchema,
      }),
    )
    .transform((cards) => cards.slice(0, 15)),
});

export const proposalSchema = z.object({
  id: z.uuid(),
  front: generatedFrontSchema,
  back: generatedBackSchema,
});

export type GenerateFlashcardsInput = z.infer<typeof generateFlashcardsSchema>;
export type ModelOutput = z.infer<typeof modelOutputSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
