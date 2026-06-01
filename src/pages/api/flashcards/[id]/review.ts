import type { APIRoute } from "astro";
import { z, ZodError } from "zod";
import { gradeReviewSchema } from "@/lib/schemas/review.schemas";
import { gradeCard } from "@/lib/services/review.service";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const flashcardIdSchema = z.uuid();
const gradeReviewRequestSchema = gradeReviewSchema.extend({
  practice: z.boolean().optional(),
});

function badRequest(error: string, issues?: ZodError["issues"]) {
  return Response.json({ error, issues }, { status: 400 });
}

function parseId(rawId: string | undefined): { id?: string; error?: Response } {
  const parsed = flashcardIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return { error: badRequest("Validation failed", parsed.error.issues) };
  }
  return { id: parsed.data };
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, error: idError } = parseId(context.params.id);
  if (idError) {
    return idError;
  }
  if (!id) {
    return badRequest("Validation failed");
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsedBody = gradeReviewRequestSchema.safeParse(payload);
  if (!parsedBody.success) {
    return badRequest("Validation failed", parsedBody.error.issues);
  }

  if (parsedBody.data.practice === true) {
    return Response.json({ data: null, skipped: true }, { status: 200 });
  }

  const { data, error } = await gradeCard(supabase, id, context.locals.user.id, parsedBody.data.rating);
  if (error === "Flashcard not found") {
    return Response.json({ error }, { status: 404 });
  }

  if (error || !data) {
    return Response.json({ error: error ?? "Failed to grade flashcard" }, { status: 500 });
  }

  return Response.json({ data }, { status: 200 });
};
