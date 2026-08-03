import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listPlatformAccounts } from "@/features/account-library/account-library-queries";
import { toPlatformAccountDtos } from "@/features/account-library/account-library-ui-adapters";

import {
  currentUserFromAuth,
  loadConsoleDashboardHome,
  organizationSettingsForClient,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function AccountLibraryPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const [accounts, dashboardHome, organizationSettings] = await Promise.all([
    listPlatformAccounts(supabase),
    loadConsoleDashboardHome(supabase, auth),
    organizationSettingsForClient(supabase, auth),
  ]);
  const dtos = toPlatformAccountDtos(accounts, auth.role);

  return (
    <OpsReferenceApp
      initialRoute="account-library"
      accountLibraryAccounts={dtos}
      dashboardHome={dashboardHome}
      dashboardHomeError={dashboardHome ? null : "角色看板暂不可用"}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettings}
    />
  );
}
