import { Rating } from "ts-fsrs";
import { z } from "zod";

export const gradeReviewSchema = z.object({
  rating: z.union([z.literal(Rating.Again), z.literal(Rating.Hard), z.literal(Rating.Good), z.literal(Rating.Easy)]),
});

export type GradeReviewInput = z.infer<typeof gradeReviewSchema>;
