"use server";

import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function signInAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/login?error=config");
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  const context = await getAuthContext(supabase);
  if (context) {
    await writeAuditLog(supabase, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorName: context.name,
      actorRole: context.role,
      action: "login",
      module: "auth",
      objectType: "session",
      result: error ? "failure" : "success",
      errorMessage: error?.message,
    });
  }

  if (error) {
    redirect("/login?error=auth");
  }

  redirect("/console/projects");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect("/login");
}
