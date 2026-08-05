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
