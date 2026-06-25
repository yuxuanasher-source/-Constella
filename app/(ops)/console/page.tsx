import OpsReferenceApp from "@/components/reference-ui/ops-reference";

import {
  currentUserFromAuth,
  loadConsoleDashboardHome,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

export default async function ConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const dashboardHome = await loadConsoleDashboardHome(supabase, auth);

  return (
    <OpsReferenceApp
      initialRoute="warroom"
      dashboardHome={dashboardHome}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
