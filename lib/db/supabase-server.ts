import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

import {
  getPublicEnv,
  getServerEnv,
  getSupabaseInternalUrl,
} from "@/lib/config/env";

function getSupabaseConfig() {
  return getPublicEnv();
}

// supabase-js 的默认 auth 存储键：`sb-<URL 主机名首段>-auth-token`。
// 浏览器与中间件按公网 NEXT_PUBLIC_SUPABASE_URL 推导 cookie 名；服务端若经
// SUPABASE_INTERNAL_URL（如 http://127.0.0.1:8000）直连，放任其按内网主机名
// 推导会得到 `sb-127-auth-token` 之类的错误名，读不到会话。因此内网直连时
// 必须把 cookie 名显式固定为「按公网地址推导的默认名」。
export function defaultAuthCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// 服务端连 Supabase 的地址：优先内网直连（SUPABASE_INTERNAL_URL），未配置
// 时回落公网地址。返回值中 cookieName 仅在内网直连时非空（此时才需要显式
// 固定 cookie 名；未配置内网地址时保持原默认行为，零变化）。
function resolveServerSupabaseTarget(publicUrl: string): {
  url: string;
  cookieName: string | null;
} {
  const internalUrl = getSupabaseInternalUrl();
  if (!internalUrl) {
    return { url: publicUrl, cookieName: null };
  }
  return { url: internalUrl, cookieName: defaultAuthCookieName(publicUrl) };
}

// React.cache: 同一次 SSR 请求内（layout/page/嵌套组件）复用同一个
// server client 实例，避免重复解析 cookie 并让下游按实例键控的缓存
// （如 getAuthContext）能够命中。渲染上下文之外（如部分路由处理器）
// cache 自动退化为直接调用，无跨请求泄漏风险。
export const createSupabaseServerClient = cache(
  async (): Promise<SupabaseClient | null> => {
    try {
      const config = getSupabaseConfig();
      const target = resolveServerSupabaseTarget(
        config.NEXT_PUBLIC_SUPABASE_URL,
      );
      const cookieStore = await cookies();

      return createServerClient(
        target.url,
        config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
          ...(target.cookieName
            ? { cookieOptions: { name: target.cookieName } }
            : null),
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
    const target = resolveServerSupabaseTarget(
      config.NEXT_PUBLIC_SUPABASE_URL,
    );

    return createClient(target.url, serverConfig.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }) as SupabaseClient;
  } catch {
    return null;
  }
}
