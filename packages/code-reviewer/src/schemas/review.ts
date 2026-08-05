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

export const reviewCriterionSchema = z.enum([
  "correctness",
  "readability",
  "testCoverage",
  "security",
  "errorHandling",
  "maintainability",
  "consistency",
]);

export const reviewFindingSchema = z.object({
  title: z.string().min(5).max(160),
  severity: z.enum(["low", "medium", "high", "critical"]),
  criterion: reviewCriterionSchema,
  filePath: z.string().min(1).optional(),
  evidence: z.string().min(10),
  recommendation: z.string().min(10),
});

export const reviewOutputSchema = z
  .object({
    summary: z.string().describe("Brief overall summary of the diff quality"),
    scores: reviewScoresSchema,
    findings: z.array(reviewFindingSchema).default([]),
    recommendations: z.array(z.string().min(5)).default([]),
  })
  .superRefine((value, ctx) => {
    const hasLowScore = Object.values(value.scores).some((score) => score < 7);

    if (hasLowScore && (value.findings.length < 3 || value.findings.length > 7)) {
      ctx.addIssue({
        code: "custom",
        path: ["findings"],
        message: "When any score is below 7, include between 3 and 7 findings.",
      });
    }

    if (hasLowScore && value.recommendations.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendations"],
        message: "When any score is below 7, include at least 2 prioritized recommendations.",
      });
    }
  });

export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
