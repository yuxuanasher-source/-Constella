import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { jsonError } from "@/lib/http/route-input";

export type AuthedContext<P> = {
  supabase: SupabaseClient;
  auth: AuthContext;
  request: Request;
  params: P;
};

export type AuthedHandler<P> = (
  context: AuthedContext<P>,
) => Promise<Response> | Response;

// Matches the context shape Next.js generates for a route handler. Static
// routes resolve to `{}`, dynamic segments to `{ paramName: string }`.
type EmptyParams = Record<string, never>;
type NextRouteContext<P> = { params: Promise<P> };

/**
 * Wraps an authenticated route handler so every route shares one copy of the
 * session bootstrap (Supabase client + auth context), the 401 gate, and the
 * service-error mapping. RBAC checks stay inside the handler: return a Response
 * directly, or throw a RouteError / Error mapped by {@link jsonError}.
 */
export function withAuth<P = EmptyParams>(handler: AuthedHandler<P>) {
  return async (
    request: Request,
    context?: NextRouteContext<P>,
  ): Promise<Response> => {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const params = (context ? await context.params : undefined) as P;
      return await handler({ supabase, auth, request, params });
    } catch (error) {
      return jsonError(error);
    }
  };
}
