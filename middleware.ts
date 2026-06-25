import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/config/env";

const protectedPrefixes = ["/console", "/m", "/desktop"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isProtected = protectedPrefixes.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!isProtected) {
    return response;
  }

  let env;
  try {
    env = getPublicEnv();
  } catch {
    return redirectToLogin(request, "config");
  }

  try {
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // 会话刷新后，必须把新 cookie 同时写回 request 与 response：
            //   - 写回 request → 本次请求的服务端组件读到的是「已刷新」的 token，
            //     不会再用已轮换失效的 refresh token 二次刷新（否则会话掉线、数据消失）。
            //   - 写回 response → 浏览器存下新 cookie。
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectToLogin(request);
    }

    return response;
  } catch {
    return redirectToLogin(request, "auth");
  }
}

export const config = {
  matcher: ["/console/:path*", "/m/:path*", "/desktop/:path*"],
};

function getLoginPath(pathname: string) {
  return pathname.startsWith("/m") ? "/m/login" : "/login";
}

function redirectToLogin(request: NextRequest, error?: string) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = getLoginPath(request.nextUrl.pathname);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  if (error) {
    loginUrl.searchParams.set("error", error);
  }
  return NextResponse.redirect(loginUrl);
}
