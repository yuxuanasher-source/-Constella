import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import {
  listAuditCenterEntries,
  type AuditQueryClient,
} from "@/features/audit-center/audit-center-queries";
import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import {
  toOpsReferenceReport,
  toOpsReferenceTask,
} from "@/features/live-operations/live-ui-adapters";
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
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

const routeByModule: Record<string, string> = {
  m0: "org",
  m1: "projects",
  m2: "streamers",
  m3: "streamers",
  m4: "tasks",
  m5: "reports",
  m6: "settle",
  m7: "audit",
  m8: "export",
  m9: "audit",
  m10: "warroom",
  m11: "warroom",
};

export default async function StubPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const {
    liveTasks,
    liveReports,
    liveBatches,
    liveBatchDetails,
    liveSettlementPool,
    settlementScope,
    auditEntries,
  } = await loadLiveReferenceData(module);

  return (
    <OpsReferenceApp
      initialRoute={routeByModule[module] ?? "warroom"}
      liveTasks={liveTasks}
      liveReports={liveReports}
      liveBatches={liveBatches}
      liveBatchDetails={liveBatchDetails}
      liveSettlementPool={liveSettlementPool}
      settlementScope={settlementScope}
      auditEntries={auditEntries}
    />
  );
}

async function loadLiveReferenceData(module: string) {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth || !isMcnStaff(auth.role)) {
    return {};
  }

  if (module === "m4") {
    const tasks = await listOpsLiveTaskQueue(supabase);
    return { liveTasks: tasks.map((task) => toOpsReferenceTask(task)) };
  }

  if (module === "m5") {
    const reports = await listOpsLiveReportQueue(supabase);
    return {
      liveReports: reports.map((report) => toOpsReferenceReport(report)),
    };
  }

  if (module === "m6") {
    const [batches, details, settlementScope] = await Promise.all([
      listOpsSettlementBatches(supabase),
      listOpsSettlementBatchDetails(supabase),
      getOpsSettlementDefaultScope(supabase),
    ]);
    const settlementPool = settlementScope
      ? await listOpsSettlementPool(supabase, settlementScope)
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

  if (module === "m7" || module === "m9") {
    const auditQueryClient = supabase as unknown as AuditQueryClient;
    const entries = await listAuditCenterEntries(
      auditQueryClient,
      {
        userId: auth.userId,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      { limit: 50 },
    );
    return { auditEntries: entries };
  }

  return {};
}
