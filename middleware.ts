import {
  combineChunks,
  createServerClient,
  stringFromBase64URL,
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { verifySupabaseJwt } from "@/lib/auth/verify-supabase-jwt";
import { getPublicEnv } from "@/lib/config/env";

const protectedPrefixes = [
  "/console",
  "/m",
  "/desktop",
  "/platform-admin",
  "/api/platform-admin",
];
const publicAuthPaths = new Set([
  "/m/login",
  "/m/login/",
  "/platform-admin/login",
  "/platform-admin/login/",
]);

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (publicAuthPaths.has(request.nextUrl.pathname)) {
    return response;
  }

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

  // 可选本地验签快路径：配置 SUPABASE_JWT_SECRET（Supabase docker .env 的
  // JWT_SECRET）时，直接在 Edge 内用 WebCrypto 校验 cookie 里的 access token
  // （HS256 签名 + exp + sub），受保护请求不再每次打一趟 GoTrue /user。
  // 验签不过（缺 cookie / 过期 / 签名不符）不直接判死：落回下方原有的
  // getUser 网络路径，由它完成会话刷新（过期但 refresh token 有效的场景）
  // 或重定向登录，行为与未配置该 env 时完全一致。
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (jwtSecret) {
    const accessToken = await readAccessTokenFromCookies(request);
    if (accessToken && (await verifySupabaseJwt(accessToken, jwtSecret))) {
      return response;
    }
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
  matcher: [
    "/console/:path*",
    "/m/:path*",
    "/desktop/:path*",
    "/platform-admin/:path*",
    "/api/platform-admin/:path*",
  ],
};

// 从请求 cookie 中还原 Supabase 会话里的 access token。@supabase/ssr 的存储
// 格式：cookie 名 `sb-<host首段>-auth-token`（超长时分块为 `.0`/`.1`…），值为
// `base64-<base64url(JSON 会话)>`（旧版为裸 JSON）。这里不写死 cookie 名前缀
// 里的主机段，按模式匹配即可（不会误匹配 `-code-verifier` 等辅助 cookie）。
async function readAccessTokenFromCookies(
  request: NextRequest,
): Promise<string | null> {
  const baseNames = new Set<string>();
  for (const { name } of request.cookies.getAll()) {
    const match = /^(sb-.+-auth-token)(?:\.\d+)?$/.exec(name);
    if (match) {
      baseNames.add(match[1]);
    }
  }

  for (const baseName of baseNames) {
    try {
      const combined = await combineChunks(
        baseName,
        (name) => request.cookies.get(name)?.value,
      );
      if (!combined) {
        continue;
      }
      const json = combined.startsWith("base64-")
        ? stringFromBase64URL(combined.slice("base64-".length))
        : combined;
      const session: unknown = JSON.parse(json);
      const accessToken = (session as { access_token?: unknown } | null)
        ?.access_token;
      if (typeof accessToken === "string" && accessToken.length > 0) {
        return accessToken;
      }
    } catch {
      // 格式异常时继续尝试其它候选 cookie；全部失败则走网络路径。
    }
  }

  return null;
}

function getLoginPath(pathname: string) {
  if (
    pathname.startsWith("/platform-admin") ||
    pathname.startsWith("/api/platform-admin")
  ) {
    return "/platform-admin/login";
  }
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
