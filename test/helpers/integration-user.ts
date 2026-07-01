export const TEST_USER_EMAIL = "test@integration.local";
export const TEST_USER_PASSWORD = "integration-test-password";

export function getTestUserId() {
  const userId = process.env.TEST_SUPABASE_USER_ID;

  if (!userId) {
    throw new Error("Integration test user was not seeded by global setup");
  }

  return userId;
}
