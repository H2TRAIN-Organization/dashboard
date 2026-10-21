import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";

const environmentSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type SupabaseServerConfig = z.infer<typeof environmentSchema>;

/**
 * Reads configuration lazily. It never falls back to a hard-coded project URL or
 * key, so a missing environment fails closed instead of reaching a shared
 * project by accident.
 */
export function readSupabaseServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseServerConfig {
  const result = environmentSchema.safeParse({
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success) {
    throw new Error(
      "Supabase no está configurado: faltan SUPABASE_URL y/o SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return result.data;
}

/**
 * Official Supabase SSR client for server-side code. This is a transport
 * factory only: repositories and credential verification are deliberately not
 * implemented until the legacy schema and credential format are inspected.
 */
export async function createSupabaseServerClient() {
  const config = readSupabaseServerConfig();
  const cookieStore = await cookies();

  return createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Route handlers can, and
          // session refresh is expected to happen there.
        }
      },
    },
  });
}
