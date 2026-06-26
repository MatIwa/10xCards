import type { SupabaseClient } from "@supabase/supabase-js";

interface DeleteAccountResult {
  deletedFlashcards: number;
  error: string | null;
}

export async function deleteAccount(adminClient: SupabaseClient, userId: string): Promise<DeleteAccountResult> {
  const flashcardCountResponse = await adminClient
    .from("flashcards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (flashcardCountResponse.error) {
    return { deletedFlashcards: 0, error: flashcardCountResponse.error.message };
  }

  const deletedFlashcards = flashcardCountResponse.count ?? 0;
  const deleteUserResponse = await adminClient.auth.admin.deleteUser(userId);

  if (deleteUserResponse.error) {
    return { deletedFlashcards: 0, error: deleteUserResponse.error.message };
  }

  // TABLES: this orphan-check must list every user-scoped table.
  // When adding any new table with user_id -> auth.users(id), declare
  // `on delete cascade` in its migration AND extend this verification.
  // See context/foundation/lessons.md (user-scoped tables rule).
  const orphanedFlashcardsResponse = await adminClient.from("flashcards").select("id").eq("user_id", userId).limit(1);

  if (orphanedFlashcardsResponse.error) {
    return { deletedFlashcards, error: orphanedFlashcardsResponse.error.message };
  }

  if (orphanedFlashcardsResponse.data.length > 0) {
    return { deletedFlashcards, error: "Verification failed: orphaned flashcards remain" };
  }

  return { deletedFlashcards, error: null };
}
