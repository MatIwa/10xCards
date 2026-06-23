import type { APIRoute } from "astro";
import { ZodError } from "zod";
import { generateFlashcardsSchema } from "@/lib/schemas/ai-generation.schemas";
import { generateProposals, type GenerationError } from "@/lib/services/ai-generation.service";
import { createClient } from "@/lib/supabase";

function badRequest(error: string, issues?: ZodError["issues"]) {
  return Response.json({ error, issues }, { status: 400 });
}

function mapGenerationError(error: GenerationError) {
  if (error.code === "missing_api_key") {
    return Response.json({ error: "AI generation is not configured", code: error.code }, { status: 500 });
  }

  return Response.json({ error: error.message, code: error.code }, { status: 502 });
}

function unexpectedErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }

  return typeof error;
}

export const POST: APIRoute = async (context) => {
  try {
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

    const parsed = generateFlashcardsSchema.safeParse(payload);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.issues);
    }

    const result = await generateProposals(parsed.data.source_text);
    if (result.error) {
      return mapGenerationError(result.error);
    }

    return Response.json({ proposals: result.data }, { status: 200 });
  } catch (error) {
    // eslint-disable-next-line no-console -- Defensive route logging excludes request content.
    console.error("generate_route_unexpected", { error: unexpectedErrorName(error) });
    return Response.json({ error: "Internal error", code: "internal_error" }, { status: 500 });
  }
};
