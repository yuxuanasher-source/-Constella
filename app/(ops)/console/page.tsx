import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

export default async function ConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  let dashboardHome = null;
  let dashboardHomeError: string | null = null;

  try {
    dashboardHome = await loadRoleHomeDashboard({ supabase, auth });
  } catch (error) {
    dashboardHomeError = "角色看板暂不可用";
    console.error("Failed to load role dashboard", error);
  }

  return (
    <OpsReferenceApp
      initialRoute="home"
      dashboardHome={dashboardHome}
      dashboardHomeError={dashboardHomeError}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
