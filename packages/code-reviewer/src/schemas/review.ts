import { z } from "zod";

export const SEVERITIES = ["info", "minor", "major", "critical"] as const;
export const VERDICTS = ["approve", "comment", "request_changes"] as const;

export const reviewInputSchema = z.object({
  diff: z.string().min(1).describe("Unified diff to review"),
  filePaths: z.array(z.string()).optional().describe("Optional list of file paths for additional context"),
});

export const reviewFindingSchema = z.object({
  severity: z.enum(SEVERITIES).describe("How serious is this finding"),
  category: z.string().describe("Short category label, e.g. security, logic, style, performance"),
  file: z.string().optional().describe("File path the finding applies to"),
  line: z.number().int().optional().describe("Line number in the diff where the finding applies"),
  message: z.string().describe("Clear description of the finding"),
  suggestion: z.string().optional().describe("Concrete suggestion for how to fix or improve"),
});

export const reviewOutputSchema = z.object({
  summary: z.string().describe("Brief overall summary of the diff quality"),
  verdict: z.enum(VERDICTS).describe("Overall review decision"),
  findings: z.array(reviewFindingSchema).describe("Individual findings, most severe first"),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
