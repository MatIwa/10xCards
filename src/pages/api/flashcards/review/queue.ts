import type { APIRoute } from "astro";
import { z } from "zod";
import { listDueCards, listPracticeCards, previewRatings } from "@/lib/services/review.service";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const queueModeSchema = z.enum(["due", "practice"]);

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const parsedMode = queueModeSchema.safeParse(context.url.searchParams.get("mode") ?? "due");
  if (!parsedMode.success) {
    return Response.json({ error: "Validation failed", issues: parsedMode.error.issues }, { status: 400 });
  }

  const mode = parsedMode.data;
  const result = mode === "practice" ? await listPracticeCards(supabase) : await listDueCards(supabase);

  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "Failed to load review queue" }, { status: 500 });
  }

  const data = result.data.map((flashcard) => {
    const preview = previewRatings(flashcard);

    return {
      ...flashcard,
      preview: {
        again: preview.again.toISOString(),
        hard: preview.hard.toISOString(),
        good: preview.good.toISOString(),
        easy: preview.easy.toISOString(),
      },
    };
  });

  return Response.json({ data, mode }, { status: 200 });
};
