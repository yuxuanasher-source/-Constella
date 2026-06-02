import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import {
  toOpsReferenceReport,
  toOpsReferenceTask,
} from "@/features/live-operations/live-ui-adapters";
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
  const { liveTasks, liveReports } = await loadLiveReferenceData(module);

  return (
    <OpsReferenceApp
      initialRoute={routeByModule[module] ?? "warroom"}
      liveTasks={liveTasks}
      liveReports={liveReports}
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

  return {};
}
