import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicEnv, getServerEnv } from "@/lib/config/env";

function getSupabaseConfig() {
  return getPublicEnv();
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
    const serverConfig = getServerEnv();

    return createClient(
      config.NEXT_PUBLIC_SUPABASE_URL,
      serverConfig.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    ) as SupabaseClient;
  } catch {
    return null;
  }
}
