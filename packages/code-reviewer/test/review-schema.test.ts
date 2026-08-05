import { describe, expect, it } from "vitest";

import { reviewInputSchema, reviewOutputSchema } from "../src/schemas/review.js";

describe("reviewOutputSchema", () => {
  const validOutput = {
    summary: "Looks good overall with one minor security gap.",
    scores: {
      correctness: 8,
      readability: 9,
      testCoverage: 7,
      security: 6,
      errorHandling: 8,
      maintainability: 8,
      consistency: 9,
    },
    findings: [
      {
        title: "Potential secret handling issue",
        severity: "medium",
        criterion: "security",
        filePath: "src/lib/supabase.ts",
        evidence: "A sensitive token appears in log-related code paths.",
        recommendation: "Remove secret values from logs and mask sensitive fields before output.",
      },
      {
        title: "Insufficient negative-path verification",
        severity: "low",
        criterion: "testCoverage",
        evidence: "No tests are shown for failed validation branches.",
        recommendation: "Add tests for invalid inputs and expected error responses.",
      },
      {
        title: "Non-idiomatic local error handling",
        severity: "low",
        criterion: "consistency",
        evidence: "The patch introduces handling that diverges from established patterns.",
        recommendation: "Align error handling with existing service conventions in the repository.",
      },
    ],
    recommendations: [
      "Block release until secret logging is removed.",
      "Add focused tests for failure paths and regressions.",
    ],
  };

  it("accepts valid score payload with all 7 criteria", () => {
    expect(() => reviewOutputSchema.parse(validOutput)).not.toThrow();
  });

  it("rejects scores outside 1..10 and non-integers", () => {
    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        scores: {
          ...validOutput.scores,
          correctness: 0,
        },
      }),
    ).toThrow();

    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        scores: {
          ...validOutput.scores,
          correctness: 11,
        },
      }),
    ).toThrow();

    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        scores: {
          ...validOutput.scores,
          correctness: 7.5,
        },
      }),
    ).toThrow();
  });

  it("rejects missing criteria", () => {
    const { consistency, ...scoresWithoutConsistency } = validOutput.scores;

    expect(consistency).toBe(9);
    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        scores: scoresWithoutConsistency,
      }),
    ).toThrow();
  });

  it("rejects low-score payloads without 3-7 findings", () => {
    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        findings: [validOutput.findings[0]],
      }),
    ).toThrow();

    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        findings: [...validOutput.findings, ...validOutput.findings, ...validOutput.findings],
      }),
    ).toThrow();
  });

  it("rejects low-score payloads with too few recommendations", () => {
    expect(() =>
      reviewOutputSchema.parse({
        ...validOutput,
        recommendations: ["Single recommendation"],
      }),
    ).toThrow();
  });
});

describe("reviewInputSchema", () => {
  it("accepts optional title and description", () => {
    expect(() =>
      reviewInputSchema.parse({
        diff: "diff --git a/a.ts b/a.ts",
        filePaths: ["a.ts"],
        title: "Update parser",
        description: "This PR adjusts parsing for edge cases.",
      }),
    ).not.toThrow();

    expect(() =>
      reviewInputSchema.parse({
        diff: "diff --git a/a.ts b/a.ts",
      }),
    ).not.toThrow();
  });
});
