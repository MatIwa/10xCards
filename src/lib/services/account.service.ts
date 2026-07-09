import type { SupabaseClient } from "@supabase/supabase-js";

interface DataResult<T> {
  data: T | null;
  error: string | null;
}

// TABLES: this orphan-check must list every user-scoped table.
// When adding any new table with user_id -> auth.users(id), declare
// `on delete cascade` in its migration AND extend this verification.
// See context/foundation/lessons.md (user-scoped tables rule).
export const USER_SCOPED_TABLES = ["flashcards"] as const;

export async function deleteAccount(adminClient: SupabaseClient, userId: string): Promise<DataResult<number>> {
  const flashcardCountResponse = await adminClient
    .from("flashcards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (flashcardCountResponse.error) {
    return { data: null, error: flashcardCountResponse.error.message };
  }

  const deletedFlashcards = flashcardCountResponse.count ?? 0;
  const deleteUserResponse = await adminClient.auth.admin.deleteUser(userId);

  if (deleteUserResponse.error) {
    return { data: null, error: deleteUserResponse.error.message };
  }

  for (const table of USER_SCOPED_TABLES) {
    const orphanedRowsResponse = await adminClient.from(table).select("id").eq("user_id", userId).limit(1);

    if (orphanedRowsResponse.error) {
      return { data: null, error: orphanedRowsResponse.error.message };
    }

    if (orphanedRowsResponse.data.length > 0) {
      return { data: null, error: `Verification failed: orphaned rows in ${table}` };
    }
  }

  return { data: deletedFlashcards, error: null };
}
