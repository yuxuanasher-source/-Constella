import OpsReferenceApp from "@/components/reference-ui/ops-reference";
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
  listOpsSettlementBatchDetails,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";
import {
  toOpsReferenceBatch,
  toOpsReferenceBatchDetailItem,
  toOpsReferenceSettlementPoolItem,
} from "@/features/settlements/settlement-ui-adapters";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function ProjectsPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const collaborationRepo = new SupabaseProjectCollaborationRepository(
    createSupabaseAdminClient() ?? supabase,
  );
  const [
    projects,
    collaborations,
    liveTasks,
    settlementData,
  ] = await Promise.all([
    listProjects(supabase),
    loadPartnerCollaborations(collaborationRepo, auth),
    listOpsLiveTaskQueue(supabase, auth.organizationId),
    loadSettlementReferenceData(supabase, auth.organizationId),
  ]);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
      projectCards={toProjectCardDtos(projects)}
      collaborationProjectCards={[
        ...toCollaborationProjectCardDtos(collaborations.projects),
        ...toCollaborationApplicationProjectCardDtos(
          collaborations.applications,
        ),
      ]}
      liveTasks={liveTasks.map((task) => toOpsReferenceTask(task))}
      liveBatches={settlementData.liveBatches}
      liveBatchDetails={settlementData.liveBatchDetails}
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

async function loadSettlementReferenceData(
  supabase: SupabaseClient,
  organizationId: string,
) {
  const [batches, details, settlementScope] = await Promise.all([
    listOpsSettlementBatches(supabase, organizationId),
    listOpsSettlementBatchDetails(supabase, { organizationId }),
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
    liveBatchDetails: Object.fromEntries(
      Object.entries(details).map(([batchId, items]) => [
        batchId,
        items.map((item) => toOpsReferenceBatchDetailItem(item)),
      ]),
    ),
    liveSettlementPool: settlementPool.map((item) =>
      toOpsReferenceSettlementPoolItem(item),
    ),
    settlementScope,
  };
}
