import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import type { AuthContext } from "@/lib/auth/context";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import { getProjectComplexCostSettings } from "@/features/complex-cost/complex-cost-queries";
import {
  toOpsReferenceBatch,
  toOpsReferenceBatchDetailItem,
  toOpsReferenceSettlementPoolItem,
} from "@/features/settlements/settlement-ui-adapters";
import { listStreamerPool } from "@/features/streamers/streamer-queries";
import { toStreamerCardDtos } from "@/features/streamers/streamer-ui-dto";
import { routeForOpsModule } from "@/features/ui-route-contracts/module-route-map";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "../../console-auth";

export default async function StubPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const { supabase, auth } = await requireConsoleStaffAuth();
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
    complexCost,
  } = await loadLiveReferenceData(module, supabase, auth);
  const route = routeForOpsModule(module);

  return (
    <OpsReferenceApp
      initialRoute={route?.routeKey ?? "warroom"}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
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
      complexCost={complexCost}
    />
  );
}

async function loadLiveReferenceData(
  module: string,
  supabase: SupabaseClient,
  auth: AuthContext,
) {
  if (module === "m2") {
    const streamers = await listStreamerPool(supabase);
    return { streamerCards: toStreamerCardDtos(streamers) };
  }

  if (module === "m3") {
    const applications = await listOpsApplicationQueue(supabase);
    return { applicationQueue: applications };
  }

  if (module === "m4") {
    const tasks = await listOpsLiveTaskQueue(supabase, auth.organizationId);
    return { liveTasks: tasks.map((task) => toOpsReferenceTask(task)) };
  }

  if (module === "m5") {
    const reports = await listOpsLiveReportQueue(supabase, auth.organizationId);
    return {
      liveReports: reports.map((report) => toOpsReferenceReport(report)),
    };
  }

  if (module === "m6") {
    const [batches, details, settlementScope] = await Promise.all([
      listOpsSettlementBatches(supabase, auth.organizationId),
      listOpsSettlementBatchDetails(supabase, {
        organizationId: auth.organizationId,
      }),
      getOpsSettlementDefaultScope(supabase, auth.organizationId),
    ]);
    const settlementPool = settlementScope
      ? await listOpsSettlementPool(supabase, {
          organizationId: auth.organizationId,
          projectId: settlementScope.projectId,
          periodStart: settlementScope.periodStart,
          periodEnd: settlementScope.periodEnd,
        })
      : [];
    const complexCost = settlementScope?.projectId
      ? await loadComplexCostReferenceData(
          supabase,
          auth,
          settlementScope.projectId,
        )
      : { enabled: false, includedProjects: 0, usedProjects: 0 };
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
      complexCost,
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

async function loadComplexCostReferenceData(
  supabase: SupabaseClient,
  auth: AuthContext,
  projectId: string,
) {
  const settings = await getProjectComplexCostSettings(supabase, {
    organizationId: auth.organizationId,
    projectId,
  });
  return {
    enabled: Boolean(settings.entitlement),
    includedProjects: 5,
    usedProjects: settings.entitlement ? 1 : 0,
    activeRuleVersion: settings.activeRule?.versionNo ?? null,
  };
}
