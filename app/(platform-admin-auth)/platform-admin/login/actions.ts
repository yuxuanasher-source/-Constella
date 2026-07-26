"use server";

import { redirect } from "next/navigation";

import { getPlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function platformAdminSignInAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/platform-admin/login?error=config");
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/platform-admin/login?error=auth");
  }

  const context = await getPlatformAdminContext();
  if (!context) {
    await supabase.auth.signOut();
    redirect("/platform-admin/login?error=forbidden");
  }

  redirect("/platform-admin/organizations");
}
