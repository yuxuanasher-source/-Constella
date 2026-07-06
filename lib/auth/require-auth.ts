import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

// Defense-in-depth page guard that mirrors the edge middleware: if the request
// has no authenticated Supabase user, send it to the given login page. This is
// a backstop in case the middleware does not run (e.g. a misconfiguration).
//
// It checks the authenticated user rather than the org-scoped auth context on
// purpose: a logged-in user without an active organization membership should
// not be bounced into a redirect loop between a protected page and login.
//
// getAuthenticatedUser 走 React.cache（以 client 实例为键）：layout 里的这个
// 守卫和 page 里的 getAuthContext 共享同一次 GoTrue /user 结果，SSR 每页少打
// 一次网络请求。
export async function requireAuthenticatedUser(loginPath: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(loginPath);
  }

  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect(loginPath);
  }
}
