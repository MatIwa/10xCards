import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "@/lib/supabase";
import { USER_SCOPED_TABLES } from "@/lib/services/account.service";
import { POST } from "@/pages/api/account/delete";
import type { Flashcard } from "@/types";

import { readFlashcards, resetFlashcards } from "../helpers/db";
import { createIntegrationUser } from "../helpers/integration-user";
import { invokeApiRoute } from "../helpers/invoke-api-route";

type IntegrationUser = Awaited<ReturnType<typeof createIntegrationUser>>;
type IntegrationSession = Awaited<ReturnType<IntegrationUser["signIn"]>>;

interface AccountDeletedAuditPayload {
  event: string;
  user_id: string;
  flashcards_deleted_count: number;
  timestamp: string;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} for integration tests`);
  }

  return value;
}

function createServiceRoleClient() {
  return createClient(getRequiredEnv("TEST_SUPABASE_URL"), getRequiredEnv("TEST_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function insertFlashcards(userId: string, count: number) {
  const supabase = createServiceRoleClient();
  const rows = Array.from({ length: count }, (_, index) => ({
    user_id: userId,
    front: `Account delete front ${index + 1}`,
    back: `Account delete back ${index + 1}`,
    source: "manual",
  }));

  const { data, error } = await supabase.from("flashcards").insert(rows).select("*");

  if (error) {
    throw error;
  }

  return data as Flashcard[];
}

async function expectJson(response: Response) {
  return response.json() as Promise<unknown>;
}

function isAccountDeletedAuditPayload(value: unknown): value is AccountDeletedAuditPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    "user_id" in value &&
    "flashcards_deleted_count" in value &&
    "timestamp" in value &&
    typeof value.event === "string" &&
    typeof value.user_id === "string" &&
    typeof value.flashcards_deleted_count === "number" &&
    typeof value.timestamp === "string"
  );
}

describe("POST /api/account/delete", () => {
  let user: IntegrationUser;
  let session: IntegrationSession;
  let deleted = false;

  beforeEach(async () => {
    user = await createIntegrationUser({ emailPrefix: `account-delete-${randomUUID()}` });
    session = await user.signIn();
    deleted = false;
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (!deleted) {
      await resetFlashcards(user.userId);
      await createServiceRoleClient().auth.admin.deleteUser(user.userId);
    }
  });

  it("deletes the auth user and every user-scoped row", async () => {
    await insertFlashcards(user.userId, 3);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/account/delete",
      session,
      body: { confirmation: "DELETE" },
      handler: POST,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toMatch(/\/auth\/signin\?deleted=1$/);

    const adminClient = createServiceRoleClient();
    const authUser = await adminClient.auth.admin.getUserById(user.userId);
    expect(authUser.data.user).toBeNull();

    for (const table of USER_SCOPED_TABLES) {
      const { data, error } = await adminClient.from(table).select("id").eq("user_id", user.userId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }

    const auditCalls = logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isAccountDeletedAuditPayload);

    expect(auditCalls).toHaveLength(1);
    const auditPayload = auditCalls[0];
    expect(auditPayload).toMatchObject({
      event: "account_deleted",
      user_id: user.userId,
      flashcards_deleted_count: 3,
    });
    expect(new Date(auditPayload.timestamp).toString()).not.toBe("Invalid Date");
    deleted = true;
  });

  it("rejects invalid confirmation and leaves rows intact", async () => {
    await insertFlashcards(user.userId, 3);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/account/delete",
      session,
      body: { confirmation: "delete" },
      handler: POST,
    });
    const body = await expectJson(response);
    const remainingFlashcards = await readFlashcards(user.userId);
    const authUser = await createServiceRoleClient().auth.admin.getUserById(user.userId);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Validation failed" });
    expect(remainingFlashcards).toHaveLength(3);
    expect(authUser.data.user?.id).toBe(user.userId);
  });

  it("returns 401 without a session", async () => {
    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/account/delete",
      body: { confirmation: "DELETE" },
      handler: POST,
    });
    const body = await expectJson(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("propagates sign-out failures to the API response", async () => {
    const originalCreateClient = supabaseModule.createClient;
    const signOutErrorMessage = "local signout failed";
    const signOutSpy = vi.fn().mockResolvedValue({ error: { message: signOutErrorMessage } });

    vi.spyOn(supabaseModule, "createClient").mockImplementation((...args) => {
      const original = originalCreateClient(...args);
      if (!original) {
        return null;
      }

      Object.defineProperty(original.auth, "signOut", {
        value: signOutSpy,
        configurable: true,
      });

      return original;
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await invokeApiRoute({
      method: "POST",
      pathname: "/api/account/delete",
      session,
      body: { confirmation: "DELETE" },
      handler: POST,
    });
    const body = await expectJson(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Account deleted, but sign-out failed. Please refresh and sign in again.",
      code: "signout_failed",
    });
    expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" });
    expect(errorSpy).toHaveBeenCalledWith("account_delete_signout_failed", {
      user_id: user.userId,
      error: signOutErrorMessage,
    });

    deleted = true;
  });
});
