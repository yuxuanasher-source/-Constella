import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/config/env";

const protectedPrefixes = ["/console", "/m", "/desktop"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
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
