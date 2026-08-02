import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import { listOpsLiveTaskQueue } from "@/features/live-operations/live-operations-queries";
import { toOpsReferenceTask } from "@/features/live-operations/live-ui-adapters";
import { listProjects } from "@/features/projects/project-queries";
import {
  toCollaborationApplicationProjectCardDtos,
  toCollaborationProjectCardDtos,
  toProjectCardDtos,
} from "@/features/projects/project-ui-dto";
import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import type { AuthContext } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  getOpsSettlementDefaultScope,
  listOpsSettlementBatches,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";
import {
  toOpsReferenceBatch,
  toOpsReferenceSettlementPoolItem,
} from "@/features/settlements/settlement-ui-adapters";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  currentUserFromAuth,
  loadConsoleDashboardHome,
  organizationSettingsForClient,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function ProjectsPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const collaborationRepo = new SupabaseProjectCollaborationRepository(
    createSupabaseAdminClient() ?? supabase,
  );
  // 项目/任务/批次三份数据页面与角色看板都需要：只发起一次查询，把
  // 进行中的 Promise 同时交给页面渲染与 loadConsoleDashboardHome，
  // 避免看板内部再跑一遍同样的查询。
  const projectsPromise = listProjects(supabase, {
    organizationId: auth.organizationId,
  });
  const applicationQueuePromise = listOpsApplicationQueue(supabase, {
    organizationId: auth.organizationId,
  });
  const liveTasksPromise = listOpsLiveTaskQueue(supabase, auth.organizationId);
  const batchesPromise = listOpsSettlementBatches(
    supabase,
    auth.organizationId,
  );
  const [
    projects,
    applicationQueue,
    collaborations,
    liveTasks,
    settlementData,
    dashboardHome,
    organizationSettings,
  ] = await Promise.all([
    projectsPromise,
    applicationQueuePromise,
    loadPartnerCollaborations(collaborationRepo, auth),
    liveTasksPromise,
    loadSettlementReferenceData(supabase, auth.organizationId, batchesPromise),
    loadConsoleDashboardHome(supabase, auth, {
      projects: projectsPromise,
      applications: applicationQueuePromise,
      tasks: liveTasksPromise,
      batches: batchesPromise,
    }),
    organizationSettingsForClient(supabase, auth),
  ]);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      dashboardHome={dashboardHome}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettings}
      projectCards={toProjectCardDtos(projects)}
      applicationQueue={applicationQueue}
      collaborationProjectCards={[
        ...toCollaborationProjectCardDtos(collaborations.projects),
        ...toCollaborationApplicationProjectCardDtos(
          collaborations.applications,
        ),
      ]}
      liveTasks={liveTasks.map((task) => toOpsReferenceTask(task))}
      liveBatches={settlementData.liveBatches}
      liveSettlementPool={settlementData.liveSettlementPool}
      settlementScope={settlementData.settlementScope}
    />
  );
}

// Partner collaboration data is loaded through the service-role admin client.
// If that client is misconfigured (e.g. a bad SUPABASE_SERVICE_ROLE_KEY) or the
// query fails, degrade to no collaboration data and log it instead of letting
// the error 500 the entire projects console.
async function loadPartnerCollaborations(
  repo: SupabaseProjectCollaborationRepository,
  auth: AuthContext,
): Promise<{
  projects: Awaited<ReturnType<typeof listPartnerCollaborationProjects>>;
  applications: Awaited<
    ReturnType<typeof listPartnerCollaborationApplications>
  >;
}> {
  try {
    const [projects, applications] = await Promise.all([
      listPartnerCollaborationProjects({ repo, actor: auth }),
      listPartnerCollaborationApplications({ repo, actor: auth }),
    ]);
    return { projects, applications };
  } catch (error) {
    console.error(
      "[console/projects] failed to load partner collaborations",
      error,
    );
    return { projects: [], applications: [] };
  }
}

// 项目页入口不再预载全组织的批次明细（listOpsSettlementBatchDetails 是全量
// 三表联查，projects 路由首屏根本用不到）：结算中心屏在查看某个批次且明细
// 缺失时会按需拉 /api/settlement-batches/[batchId]（见 ops-reference.jsx
// ScreenSettlement 的懒加载 effect）。
async function loadSettlementReferenceData(
  supabase: SupabaseClient,
  organizationId: string,
  batchesPromise: ReturnType<typeof listOpsSettlementBatches>,
) {
  const [batches, settlementScope] = await Promise.all([
    batchesPromise,
    getOpsSettlementDefaultScope(supabase, organizationId),
  ]);
  const settlementPool = settlementScope
    ? await listOpsSettlementPool(supabase, {
        organizationId,
        projectId: settlementScope.projectId,
        periodStart: settlementScope.periodStart,
        periodEnd: settlementScope.periodEnd,
      })
    : [];

  return {
    liveBatches: batches.map((batch) => toOpsReferenceBatch(batch)),
    liveSettlementPool: settlementPool.map((item) =>
      toOpsReferenceSettlementPoolItem(item),
    ),
    settlementScope,
  };
}
