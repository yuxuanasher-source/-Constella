import {
  CollaborationsPanel,
  type CollaborationView,
} from "@/components/collaborations/collaborations-panel";
import { OpsShell } from "@/components/layouts/ops-shell";
import { listMyCollaborations } from "@/features/collaborations/collaboration-queries";
import { canManageCollaboration } from "@/features/collaborations/collaboration-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { getUnreadNotificationCount } from "@/lib/notify/unread-count";
import { isMcnStaff } from "@/lib/rbac/roles";

export default async function CollaborationsPage() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  const unreadCount = await getUnreadNotificationCount(supabase, auth);

  const canView = Boolean(auth && isMcnStaff(auth.role));
  const rows =
    supabase && canView ? await listMyCollaborations(supabase) : [];
  const collaborations: CollaborationView[] = rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    settlementMode: row.settlement_mode,
    sharePercentage: row.share_percentage,
    hourlyFixedAmount: row.hourly_fixed_amount,
    inviteCode: row.invite_code,
  }));
  const canManage = Boolean(auth && canManageCollaboration(auth.role));

  return (
    <OpsShell
      context={auth}
      unreadCount={unreadCount}
      activeHref="/console/collaborations"
    >
      {canView ? (
        <CollaborationsPanel
          collaborations={collaborations}
          canManage={canManage}
        />
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-white p-10 text-center text-[var(--ink-300)]">
          需要经营端角色才能访问 MCN 协作。
        </div>
      )}
    </OpsShell>
  );
}
