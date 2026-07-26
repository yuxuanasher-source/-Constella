import { SupabasePlatformAdminRepository } from "@/features/platform-admin/platform-admin-repository-supabase";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import { requirePlatformAdminPage } from "./platform-admin-auth";

export async function getPlatformAdminPageData() {
  const actor = await requirePlatformAdminPage();
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error("Platform administration service is unavailable.");
  }
  return {
    actor,
    repo: new SupabasePlatformAdminRepository(admin),
    period: currentNaturalMonth(),
  };
}

function currentNaturalMonth() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}
