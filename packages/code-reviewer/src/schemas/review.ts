import { z } from "zod";

export const reviewInputSchema = z.object({
  diff: z.string().min(1).describe("Unified diff to review"),
  filePaths: z.array(z.string()).optional().describe("Optional list of file paths for additional context"),
  title: z.string().optional().describe("Optional pull request title"),
  description: z.string().optional().describe("Optional pull request description"),
});

export const reviewScoresSchema = z.object({
  correctness: z.number().int().min(1).max(10),
  readability: z.number().int().min(1).max(10),
  testCoverage: z.number().int().min(1).max(10),
  security: z.number().int().min(1).max(10),
  errorHandling: z.number().int().min(1).max(10),
  maintainability: z.number().int().min(1).max(10),
  consistency: z.number().int().min(1).max(10),
});

export const reviewOutputSchema = z.object({
  summary: z.string().describe("Brief overall summary of the diff quality"),
  scores: reviewScoresSchema,
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
