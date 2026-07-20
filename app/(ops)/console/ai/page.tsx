import { ConsoleAiWorkbench } from "@/components/console/ai-workbench";
import { OpsShell } from "@/components/layouts/ops-shell";

import {
  currentUserFromAuth,
  loadConsoleDashboardHome,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function AiConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  let dashboardHome = null;
  let dashboardHomeError: string | null = null;

  try {
    dashboardHome = await loadConsoleDashboardHome(supabase, auth);
    if (!dashboardHome) {
      dashboardHomeError = "AI 上下文暂不可用";
    }
  } catch (error) {
    dashboardHomeError = "AI 上下文暂不可用";
    console.error("Failed to load AI workbench dashboard", error);
  }

  return (
    <OpsShell
      context={auth}
      unreadCount={dashboardHome?.risks?.length ?? 0}
      activeHref="/console/ai"
    >
      <ConsoleAiWorkbench
        currentUser={currentUserFromAuth(auth)}
        dashboardHome={dashboardHome}
        dashboardHomeError={dashboardHomeError}
      />
    </OpsShell>
  );
}
