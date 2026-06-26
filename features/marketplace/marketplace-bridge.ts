// 撮合达成 → 现有协作流程的桥接（决策：发单方选现有项目再桥接）。
// 两步（RLS 限定协作申请由接单方自插，不可由发单方代插）：
//   1) 发单方 bridgeCreateShare：为已启用 MCN 协作的现有项目创建分享，token 落到撮合达成；
//   2) 接单方 bridgeSubmitApplication：据该 token 提交 submitted 协作申请，进入现有审核→激活。
// 本层只编排 + 守卫，分享/申请的真正落库交给现有协作服务（经 deps 注入，可单测）。

import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import { MarketplaceError } from "./marketplace-service";
import type { DealRecord } from "./marketplace-types";

export type BridgeActor = {
  userId: string;
  name?: string | null;
  role: AppRole;
  organizationId: string;
};

export type BridgeDeps = {
  getDeal(id: string): Promise<DealRecord | null>;
  updateDeal(id: string, patch: Record<string, unknown>): Promise<DealRecord | null>;
  // 发单方为某项目创建协作分享（内部走现有协作服务 + RLS）。
  createShare(input: {
    actor: BridgeActor;
    projectId: string;
  }): Promise<{ shareId: string; token: string }>;
  // 接单方据 token 提交协作申请（内部走现有协作服务 + RLS）。
  submitApplication(input: {
    actor: BridgeActor;
    token: string;
    requestedRevenueShareBps: number;
    applicantNote: string;
  }): Promise<{ applicationId: string }>;
};

export async function bridgeCreateShare(
  deps: BridgeDeps,
  actor: BridgeActor,
  dealId: string,
  projectId: string,
): Promise<{ dealId: string; shareId: string }> {
  const deal = await deps.getDeal(dealId);
  if (!deal) throw new MarketplaceError("Deal not found", 404);
  if (deal.ownerOrganizationId !== actor.organizationId || !isMcnStaff(actor.role)) {
    throw new MarketplaceError("Only the posting owner can bridge this deal", 403);
  }
  if (deal.status !== "pending_collaboration") {
    throw new MarketplaceError("Deal is not pending collaboration", 400);
  }
  if (!projectId) throw new MarketplaceError("projectId is required", 400);

  const { shareId, token } = await deps.createShare({ actor, projectId });
  await deps.updateDeal(dealId, {
    collaboration_share_id: shareId,
    collaboration_share_token: token,
  });
  return { dealId, shareId };
}

export async function bridgeSubmitApplication(
  deps: BridgeDeps,
  actor: BridgeActor,
  dealId: string,
  input: { requestedRevenueShareBps?: unknown; applicantNote?: unknown },
): Promise<{ applicationId: string }> {
  const deal = await deps.getDeal(dealId);
  if (!deal) throw new MarketplaceError("Deal not found", 404);
  if (deal.applicantOrganizationId !== actor.organizationId || !isMcnStaff(actor.role)) {
    throw new MarketplaceError(
      "Only the applicant can submit the collaboration application",
      403,
    );
  }
  if (!deal.collaborationShareToken) {
    throw new MarketplaceError(
      "The posting owner has not created the collaboration share yet",
      409,
    );
  }
  const bps = Number(input?.requestedRevenueShareBps);
  if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
    throw new MarketplaceError(
      "requestedRevenueShareBps must be between 0 and 10000",
      400,
    );
  }

  const { applicationId } = await deps.submitApplication({
    actor,
    token: deal.collaborationShareToken,
    requestedRevenueShareBps: Math.round(bps),
    applicantNote: typeof input?.applicantNote === "string" ? input.applicantNote : "",
  });
  return { applicationId };
}
