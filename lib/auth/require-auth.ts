import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/db/supabase-server";

// Defense-in-depth page guard that mirrors the edge middleware: if the request
// has no authenticated Supabase user, send it to the given login page. This is
// a backstop in case the middleware does not run (e.g. a misconfiguration).
//
// It checks the authenticated user rather than the org-scoped auth context on
// purpose: a logged-in user without an active organization membership should
// not be bounced into a redirect loop between a protected page and login.
export async function requireAuthenticatedUser(loginPath: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(loginPath);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(loginPath);
  }
}
