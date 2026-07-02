import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

import { getPublicEnv, getServerEnv } from "@/lib/config/env";

function getSupabaseConfig() {
  return getPublicEnv();
}

// React.cache: 同一次 SSR 请求内（layout/page/嵌套组件）复用同一个
// server client 实例，避免重复解析 cookie 并让下游按实例键控的缓存
// （如 getAuthContext）能够命中。渲染上下文之外（如部分路由处理器）
// cache 自动退化为直接调用，无跨请求泄漏风险。
export const createSupabaseServerClient = cache(
  async (): Promise<SupabaseClient | null> => {
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
  },
);

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
