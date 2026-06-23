import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/lib/auth/context";

// 顶部铃铛未读数：按收件人本人或角色统计未读通知。
export async function getUnreadNotificationCount(
  supabase: SupabaseClient | null,
  auth: AuthContext | null,
): Promise<number> {
  if (!supabase || !auth) {
    return 0;
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread")
    .or(`recipient_user_id.eq.${auth.userId},recipient_role.eq.${auth.role}`);

  if (error) {
    return 0;
  }

  return count ?? 0;
}
