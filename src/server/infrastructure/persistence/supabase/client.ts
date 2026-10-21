import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabasePersistenceConfig } from "../config";

/**
 * Server-only Supabase client. It always uses the `public` schema and a
 * service-role credential. No browser session, cookie or refresh token is
 * persisted here.
 */
export function createSupabaseAdminClient(
  config: SupabasePersistenceConfig,
): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: "public",
    },
  });
}
