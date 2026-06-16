import { NextResponse } from "next/server";

import {
  normalizeLoginEntryPoint,
  normalizeRoleIntent,
  resolvePostLoginPath,
} from "@/app/(auth)/login/login-workflows";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const entryPoint = normalizeLoginEntryPoint(
    url.searchParams.get("entryPoint"),
  );
  const roleIntent = normalizeRoleIntent(url.searchParams.get("roleIntent"));
  const next = normalizeRelativeNext(url.searchParams.get("next"));
  const loginPath = entryPoint === "mobile" ? "/m/login" : "/login";
  const supabase = await createSupabaseServerClient();

  if (!supabase || !code) {
    return redirectToLogin(request, loginPath);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectToLogin(request, loginPath);
  }

  const auth = await getAuthContext(supabase);
  const target = resolvePostLoginPath({
    role: auth?.role,
    roleIntent: auth?.role === "streamer" ? "streamer" : roleIntent,
    entryPoint,
    next,
  });

  return NextResponse.redirect(new URL(target, request.url));
}

function redirectToLogin(request: Request, loginPath: string) {
  return NextResponse.redirect(new URL(`${loginPath}?error=auth`, request.url));
}

function normalizeRelativeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "";
  }

  return next;
}
