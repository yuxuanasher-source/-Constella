import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { OpsConsoleV2Home } from "@/components/ops-shell/ops-console-v2-home";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { isOpsUiV2Enabled } from "@/features/ui-route-contracts/ops-ui-v2-flag";
import {
  currentUserFromAuth,
  organizationSettingsForClient,
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

  const currentUser = currentUserFromAuth(auth);
  const clientOrganizationSettings = await organizationSettingsForClient(
    supabase,
    auth,
  );

  if (isOpsUiV2Enabled()) {
    return (
      <OpsConsoleV2Home
        dashboardHome={dashboardHome}
        dashboardHomeError={dashboardHomeError}
        currentUser={currentUser}
        organizationSettings={clientOrganizationSettings}
      />
    );
  }

  return (
    <OpsReferenceApp
      initialRoute="home"
      dashboardHome={dashboardHome}
      dashboardHomeError={dashboardHomeError}
      currentUser={currentUser}
      organizationSettings={clientOrganizationSettings}
    />
  );
}
