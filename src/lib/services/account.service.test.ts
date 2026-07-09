import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { deleteAccount, USER_SCOPED_TABLES } from "./account.service";

interface QueryResponse {
  data?: unknown[] | null;
  count?: number | null;
  error: { message: string } | null;
}

interface StubOptions {
  preCount: QueryResponse;
  deleteUser: { error: { message: string } | null };
  orphanChecks?: Record<string, QueryResponse>;
}

function createAdminClientStub({ preCount, deleteUser, orphanChecks = {} }: StubOptions) {
  const deleteUserMock = vi.fn(() => Promise.resolve(deleteUser));
  const fromMock = vi.fn((table: string) => ({
    select: vi.fn((_columns: string, options?: { count?: string; head?: boolean }) => {
      if (options?.head) {
        return {
          eq: vi.fn(() => Promise.resolve(preCount)),
        };
      }

      return {
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(orphanChecks[table] ?? { data: [], error: null })),
        })),
      };
    }),
  }));

  return {
    client: {
      from: fromMock,
      auth: {
        admin: {
          deleteUser: deleteUserMock,
        },
      },
    } as unknown as SupabaseClient,
    deleteUserMock,
    fromMock,
  };
}

/**
 * Mirrors context/foundation/lessons.md: when adding a new `user_id -> auth.users(id)`
 * table, extend both this roster and USER_SCOPED_TABLES in account.service.ts; the
 * migration must declare `on delete cascade`.
 */
const EXPECTED_USER_SCOPED_TABLES = ["flashcards"] as const;

describe("deleteAccount", () => {
  it("returns the auth delete error and does not run orphan checks", async () => {
    const { client, fromMock } = createAdminClientStub({
      preCount: { count: 5, error: null },
      deleteUser: { error: { message: "auth service down" } },
    });

    const result = await deleteAccount(client, "user-id");

    expect(result).toEqual({ data: null, error: "auth service down" });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("returns a verification error when the orphan check finds a row", async () => {
    const { client } = createAdminClientStub({
      preCount: { count: 3, error: null },
      deleteUser: { error: null },
      orphanChecks: {
        flashcards: { data: [{ id: "fake-orphan" }], error: null },
      },
    });

    const result = await deleteAccount(client, "user-id");

    expect(result).toEqual({ data: null, error: "Verification failed: orphaned rows in flashcards" });
  });

  it("passes through orphan-check query errors", async () => {
    const { client } = createAdminClientStub({
      preCount: { count: 3, error: null },
      deleteUser: { error: null },
      orphanChecks: {
        flashcards: { data: null, error: { message: "network hiccup" } },
      },
    });

    const result = await deleteAccount(client, "user-id");

    expect(result).toEqual({ data: null, error: "network hiccup" });
  });

  it("returns pre-count errors before deleting the auth user", async () => {
    const { client, deleteUserMock } = createAdminClientStub({
      preCount: { count: null, error: { message: "count failed" } },
      deleteUser: { error: null },
    });

    const result = await deleteAccount(client, "user-id");

    expect(result).toEqual({ data: null, error: "count failed" });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("keeps the user-scoped table roster complete", () => {
    expect([...USER_SCOPED_TABLES].sort()).toEqual([...EXPECTED_USER_SCOPED_TABLES].sort());
  });
});
