import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

export default async function ConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const dashboardHome = await loadRoleHomeDashboard({ supabase, auth });

  return (
    <OpsReferenceApp
      initialRoute="warroom"
      dashboardHome={dashboardHome}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
