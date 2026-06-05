import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import {
  listAuditCenterEntries,
  type AuditQueryClient,
} from "@/features/audit-center/audit-center-queries";
import { getBillingStatus } from "@/features/billing/billing-status";
import {
  listNotificationCenterItems,
  type NotificationQueryClient,
} from "@/features/notifications/notification-center-queries";
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
import { listStreamerPool } from "@/features/streamers/streamer-queries";
import { toStreamerCardDtos } from "@/features/streamers/streamer-ui-dto";
import { routeForOpsModule } from "@/features/ui-route-contracts/module-route-map";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

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
    streamerCards,
    applicationQueue,
    auditEntries,
    notificationItems,
    billingStatus,
  } = await loadLiveReferenceData(module);
  const route = routeForOpsModule(module);

  return (
    <OpsReferenceApp
      initialRoute={route?.routeKey ?? "warroom"}
      liveTasks={liveTasks}
      liveReports={liveReports}
      liveBatches={liveBatches}
      liveBatchDetails={liveBatchDetails}
      liveSettlementPool={liveSettlementPool}
      settlementScope={settlementScope}
      streamerCards={streamerCards}
      applicationQueue={applicationQueue}
      auditEntries={auditEntries}
      notificationItems={notificationItems}
      billingStatus={billingStatus}
    />
  );
}

async function loadLiveReferenceData(module: string) {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth || !isMcnStaff(auth.role)) {
    return {};
  }

  if (module === "m2") {
    const streamers = await listStreamerPool(supabase);
    return { streamerCards: toStreamerCardDtos(streamers) };
  }

  if (module === "m3") {
    const applications = await listOpsApplicationQueue(supabase);
    return { applicationQueue: applications };
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

  if (module === "m7") {
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

  if (module === "m9") {
    const notificationQueryClient =
      supabase as unknown as NotificationQueryClient;
    const items = await listNotificationCenterItems(notificationQueryClient, {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
    });
    return { notificationItems: items };
  }

  if (module === "m11") {
    const billingStatus = await getBillingStatus({
      client: supabase,
      organizationId: auth.organizationId,
    });
    return { billingStatus };
  }

  return {};
}
