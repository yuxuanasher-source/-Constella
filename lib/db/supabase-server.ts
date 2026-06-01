import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { parsePublicEnv } from "@/lib/config/env";

function getSupabaseConfig() {
  const parsed = parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  return parsed;
}

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  try {
    const config = getSupabaseConfig();
    const cookieStore = await cookies();

    return createServerClient(
      config.NEXT_PUBLIC_SUPABASE_URL,
      config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // Server components cannot set cookies; route handlers can.
            }
          },
        },
      },
    ) as SupabaseClient;
  } catch {
    return null;
  }
}

export function createSupabaseAdminClient(): SupabaseClient | null {
  try {
    const config = getSupabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
      return null;
    }

    return createClient(config.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }) as SupabaseClient;
  } catch {
    return null;
  }
}
