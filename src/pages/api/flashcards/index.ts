import type { APIRoute } from "astro";
import { ZodError } from "zod";
import { createFlashcardSchema } from "@/lib/schemas/flashcard.schemas";
import { createFlashcard, listFlashcards } from "@/lib/services/flashcard.service";
import { createClient } from "@/lib/supabase";

function badRequest(error: string, issues?: ZodError["issues"]) {
  return Response.json({ error, issues }, { status: 400 });
}

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const { data, error } = await listFlashcards(supabase);
  if (error) {
    return Response.json({ error }, { status: 500 });
  }

  return Response.json({ data: data ?? [] }, { status: 200 });
};

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = createFlashcardSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Validation failed", parsed.error.issues);
  }

  const { data, error } = await createFlashcard(supabase, parsed.data, context.locals.user.id);
  if (error || !data) {
    return Response.json({ error: error ?? "Failed to create flashcard" }, { status: 500 });
  }

  return Response.json({ data }, { status: 201 });
};
