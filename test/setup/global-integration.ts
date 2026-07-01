import { createClient } from "@supabase/supabase-js";

import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from "../helpers/integration-user";

const INTEGRATION_ENV_ERROR =
  "Integration tests require local Supabase. Run `npx supabase start` and export TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY. See test-plan §6.2.";

function exitWithIntegrationEnvError(): never {
  process.stderr.write(`${INTEGRATION_ENV_ERROR}\n`);
  process.exit(1);
}

export default async function setup() {
  const supabaseUrl = process.env.TEST_SUPABASE_URL;
  const supabaseAnonKey = process.env.TEST_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    exitWithIntegrationEnvError();
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { error: healthError } = await anonClient.from("flashcards").select("id").limit(1);

  if (healthError) {
    exitWithIntegrationEnvError();
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error: createUserError } = await adminClient.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  });

  if (
    createUserError &&
    createUserError.message !== "User already registered" &&
    createUserError.code !== "email_exists"
  ) {
    throw createUserError;
  }

  const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  });

  if (signInError) {
    throw signInError;
  }

  process.env.TEST_SUPABASE_USER_ID = sessionData.user.id;

  return () => undefined;
}
