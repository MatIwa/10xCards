import type { APIRoute } from "astro";
import { z, ZodError } from "zod";
import { updateFlashcardSchema } from "@/lib/schemas/flashcard.schemas";
import { deleteFlashcard, updateFlashcard } from "@/lib/services/flashcard.service";
import { createClient } from "@/lib/supabase";

const flashcardIdSchema = z.uuid();

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

export const PUT: APIRoute = async (context) => {
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

  const parsedBody = updateFlashcardSchema.safeParse(payload);
  if (!parsedBody.success) {
    return badRequest("Validation failed", parsedBody.error.issues);
  }

  const { data, error } = await updateFlashcard(supabase, id, parsedBody.data);
  if (error === "Flashcard not found") {
    return Response.json({ error }, { status: 404 });
  }

  if (error || !data) {
    return Response.json({ error: error ?? "Failed to update flashcard" }, { status: 500 });
  }

  return Response.json({ data }, { status: 200 });
};

export const DELETE: APIRoute = async (context) => {
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

  const { error } = await deleteFlashcard(supabase, id);
  if (error === "Flashcard not found") {
    return Response.json({ error }, { status: 404 });
  }

  if (error) {
    return Response.json({ error }, { status: 500 });
  }

  return new Response(null, { status: 204 });
};
