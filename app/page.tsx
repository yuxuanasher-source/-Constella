import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { resolvePostLoginPath } from "./(auth)/login/login-workflows";

export default async function Home() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/login?error=config");
  }

  const auth = await getAuthContext(supabase);

  if (!auth) {
    redirect("/login");
  }

  redirect(
    resolvePostLoginPath({
      role: auth.role,
      roleIntent: auth.role === "streamer" ? "streamer" : "mcn",
    }),
  );
}
