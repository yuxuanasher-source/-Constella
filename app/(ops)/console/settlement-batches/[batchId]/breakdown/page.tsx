import { OpsShell } from "@/components/layouts/ops-shell";
import { SettlementBreakdownPanel } from "@/components/settlements/settlement-breakdown-panel";
import { SupabaseSettlementLineRepository } from "@/features/settlements/settlement-line-repository";
import {
  canManageCollaboration,
} from "@/features/collaborations/collaboration-service";
import { getSettlementBreakdown } from "@/features/settlements/settlement-line-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { getUnreadNotificationCount } from "@/lib/notify/unread-count";
import { isMcnStaff } from "@/lib/rbac/roles";

export default async function SettlementBreakdownPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  const unreadCount = await getUnreadNotificationCount(supabase, auth);
  const canView = Boolean(supabase && auth && isMcnStaff(auth.role));

  let content: React.ReactNode = (
    <div className="rounded-lg border border-[var(--line)] bg-white p-10 text-center text-[var(--ink-300)]">
      需要经营端角色才能查看结算明细。
    </div>
  );

  if (supabase && auth && canView) {
    const repo = new SupabaseSettlementLineRepository(supabase);
    const [breakdown, lineItems] = await Promise.all([
      getSettlementBreakdown({ repo, actor: auth, batchId }),
      repo.listLineItems(batchId),
    ]);

    content = (
      <SettlementBreakdownPanel
        batchId={batchId}
        summary={{
          revenue: breakdown.revenue,
          cost: breakdown.cost,
          grossMargin: breakdown.grossMargin,
          mcnSplit: breakdown.mcnSplit,
          netMargin: breakdown.netMargin,
        }}
        byStreamer={breakdown.byStreamer}
        collaborations={breakdown.collaborations.map((collaboration) => ({
          id: collaboration.id,
          collaborationId: collaboration.collaborationId,
          mode: collaboration.mode,
          basisAmount: collaboration.basisAmount,
          computedAmount: collaboration.computedAmount,
          manualAmount: collaboration.manualAmount,
        }))}
        lineItems={lineItems.map((item) => ({
          id: item.id,
          streamerId: item.streamerId ?? null,
          direction: item.direction,
          category: item.category,
          label: item.label,
          amount: item.amount,
        }))}
        canManage={canManageCollaboration(auth.role)}
      />
    );
  }

  return (
    <OpsShell context={auth} unreadCount={unreadCount}>
      {content}
    </OpsShell>
  );
}
