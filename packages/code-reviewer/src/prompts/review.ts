import type { ReviewInput } from "../schemas/review.js";

export const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Your job is to analyze unified diffs and return a structured, actionable review.

Guidelines:
- Ground every finding in specific lines visible in the diff. Do not invent issues not present in the diff.
- Use severity levels accurately:
  - critical: security vulnerabilities, data loss, crashes, or correctness bugs
  - major: logic errors, missing error handling, significant performance issues
  - minor: style inconsistencies, poor naming, minor inefficiencies
  - info: suggestions, nitpicks, or observations that don't require action
- Choose verdict based on the overall impact:
  - approve: no blocking issues; the change is safe to merge
  - comment: non-blocking observations worth discussing; the change can merge after author review
  - request_changes: one or more critical or major findings that must be addressed before merging
- Keep messages concise and actionable. Include concrete suggestions wherever possible.
- Return findings sorted most-severe first.`;

export function buildReviewPrompt(input: ReviewInput): string {
  const lines: string[] = [];

  if (input.filePaths && input.filePaths.length > 0) {
    lines.push(`Files changed: ${input.filePaths.join(", ")}`);
    lines.push("");
  }

  lines.push("Unified diff to review:");
  lines.push("```diff");
  lines.push(input.diff);
  lines.push("```");

  return lines.join("\n");
}
