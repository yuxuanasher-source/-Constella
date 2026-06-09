import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsLiveTaskQueue } from "@/features/live-operations/live-operations-queries";
import { toOpsReferenceTask } from "@/features/live-operations/live-ui-adapters";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
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
  const [projects, liveTasks, settlementData] = await Promise.all([
    listProjects(supabase),
    listOpsLiveTaskQueue(supabase, auth.organizationId),
    loadSettlementReferenceData(supabase, auth.organizationId),
  ]);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
      projectCards={toProjectCardDtos(projects)}
      liveTasks={liveTasks.map((task) => toOpsReferenceTask(task))}
      liveBatches={settlementData.liveBatches}
      liveBatchDetails={settlementData.liveBatchDetails}
      liveSettlementPool={settlementData.liveSettlementPool}
      settlementScope={settlementData.settlementScope}
    />
  );
}

async function loadSettlementReferenceData(
  supabase: SupabaseClient,
  organizationId: string,
) {
  const [batches, details, settlementScope] = await Promise.all([
    listOpsSettlementBatches(supabase),
    listOpsSettlementBatchDetails(supabase),
    getOpsSettlementDefaultScope(supabase, organizationId),
  ]);
  const settlementPool = settlementScope
    ? await listOpsSettlementPool(supabase, {
        organizationId,
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
