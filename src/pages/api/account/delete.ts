import type { APIRoute } from "astro";
import { ZodError } from "zod";
import { deleteAccountSchema } from "@/lib/schemas/account.schemas";
import { deleteAccount } from "@/lib/services/account.service";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase";

function badRequest(error: string, issues?: ZodError["issues"]) {
  return Response.json({ error, issues }, { status: 400 });
}

export const POST: APIRoute = async (context) => {
  const userSupabase = createClient(context.request.headers, context.cookies);
  const adminSupabase = createAdminClient();

  if (!userSupabase || !adminSupabase) {
    return Response.json({ error: "Account deletion is not configured" }, { status: 500 });
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

  const parsed = deleteAccountSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Validation failed", parsed.error.issues);
  }

  const { deletedFlashcards, error } = await deleteAccount(adminSupabase, context.locals.user.id);
  if (error) {
    console.error("account_delete_failed", { user_id: context.locals.user.id, error });
    return Response.json({ error: "Deletion failed — please try again later." }, { status: 500 });
  }

  console.log(
    JSON.stringify({
      event: "account_deleted",
      user_id: context.locals.user.id,
      flashcards_deleted_count: deletedFlashcards,
      timestamp: new Date().toISOString(),
    }),
  );

  // Local scope: cookie clear only, no server round-trip to the deleted user's session.
  // Errors are deliberately ignored — the destructive work succeeded and we must still redirect.
  await userSupabase.auth.signOut({ scope: "local" }).catch(() => undefined);

  return context.redirect("/auth/signin?deleted=1", 303);
};
