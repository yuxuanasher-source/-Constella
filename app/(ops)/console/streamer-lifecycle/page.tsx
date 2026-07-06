import { StreamerLifecyclePanel } from "@/components/streamer-lifecycle/streamer-lifecycle-panel";
import { StreamerLifecycleShell } from "@/components/streamer-lifecycle/streamer-lifecycle-shell";
import { getStreamerLifecycleOverview } from "@/features/streamer-lifecycle/streamer-lifecycle-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { getUnreadNotificationCount } from "@/lib/notify/unread-count";
import { isMcnStaff } from "@/lib/rbac/roles";

export default async function StreamerLifecyclePage() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;

  const canView = Boolean(auth && isMcnStaff(auth.role));
  const [unreadCount, overview] = await Promise.all([
    getUnreadNotificationCount(supabase, auth),
    supabase && canView
      ? getStreamerLifecycleOverview(supabase)
      : Promise.resolve({
          streamers: [],
          shiftChangeQueue: [],
          recentEvents: [],
        }),
  ]);

  return (
    <StreamerLifecycleShell
      orgName={auth?.organizationName ?? "未连接组织"}
      userName={auth?.name ?? "访客"}
      role={auth?.role ?? "guest"}
      unreadCount={unreadCount}
    >
      {canView ? (
        <StreamerLifecyclePanel
          streamers={overview.streamers}
          shiftChangeQueue={overview.shiftChangeQueue}
          recentEvents={overview.recentEvents}
        />
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-white p-10 text-center text-[var(--ink-300)]">
          需要经营端角色才能访问主播生命周期。
        </div>
      )}
    </StreamerLifecycleShell>
  );
}
