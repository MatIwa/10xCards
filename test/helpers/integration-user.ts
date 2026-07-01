import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const TEST_USER_EMAIL = "test@integration.local";
export const TEST_USER_PASSWORD = "integration-test-password";

interface CreateIntegrationUserOverrides {
  emailPrefix?: string;
  password?: string;
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

export function getTestUserId() {
  const userId = process.env.TEST_SUPABASE_USER_ID;

  if (!userId) {
    throw new Error("Integration test user was not seeded by global setup");
  }

  return userId;
}

export async function createIntegrationUser(overrides: CreateIntegrationUserOverrides = {}) {
  const emailPrefix = overrides.emailPrefix ?? `test-${randomBytes(4).toString("hex")}`;
  const password = overrides.password ?? TEST_USER_PASSWORD;
  const email = `${emailPrefix}@integration.local`;
  const adminClient = createServiceRoleClient();

  const { error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (
    createUserError &&
    createUserError.message !== "User already registered" &&
    createUserError.code !== "email_exists"
  ) {
    throw createUserError;
  }

  const { data: userList, error: listUsersError } = await adminClient.auth.admin.listUsers();
  if (listUsersError) {
    throw listUsersError;
  }

  const user = userList.users.find((candidate) => candidate.email === email);
  if (!user) {
    throw new Error(`Integration user ${email} was not created`);
  }

  return {
    email,
    password,
    userId: user.id,
    signIn: async () => {
      const { signInUser } = await import("./supabase-session");
      return signInUser({ email, password });
    },
  };
}
