// 把撮合桥接的 deps 接到现有协作服务（server-only）。纯编排在 marketplace-bridge.ts，
// 这里只负责注入真实仓储与协作服务调用，便于路由复用、且不污染可单测的纯模块。

import {
  createProjectCollaborationShare,
  submitProjectCollaborationApplication,
  SupabaseProjectCollaborationRepository,
  type ProjectCollaborationActor,
} from "@/features/collaborations/project-collaboration-service";
import { writeAuditLog } from "@/lib/audit/audit";

import type { BridgeActor, BridgeDeps } from "./marketplace-bridge";
import type { MarketplaceContext } from "./marketplace-route-utils";

function toCollabActor(actor: BridgeActor): ProjectCollaborationActor {
  return {
    userId: actor.userId,
    name: actor.name ?? undefined,
    role: actor.role,
    organizationId: actor.organizationId,
  };
}

export function buildBridgeDeps(ctx: MarketplaceContext): BridgeDeps {
  const supabase = ctx.supabase!;
  const collabRepo = new SupabaseProjectCollaborationRepository(supabase);
  const audit = (input: Parameters<typeof writeAuditLog>[1]) =>
    writeAuditLog(supabase, input);

  return {
    getDeal: (id) => ctx.repo.getDealById(id),
    updateDeal: (id, patch) => ctx.repo.updateDeal(id, patch),
    createShare: async ({ actor, projectId }) => {
      const { share, token } = await createProjectCollaborationShare({
        repo: collabRepo,
        audit,
        actor: toCollabActor(actor),
        projectId,
        input: { allowApplications: true },
      });
      return { shareId: share.id, token };
    },
    submitApplication: async ({ actor, token, requestedRevenueShareBps, applicantNote }) => {
      const application = await submitProjectCollaborationApplication({
        repo: collabRepo,
        audit,
        actor: toCollabActor(actor),
        token,
        input: { requestedRevenueShareBps, applicantNote },
      });
      return { applicationId: application.id };
    },
  };
}
