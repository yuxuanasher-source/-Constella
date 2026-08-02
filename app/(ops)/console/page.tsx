import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { OpsConsoleV2Home } from "@/components/ops-shell/ops-console-v2-home";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { isOpsUiV2Enabled } from "@/features/ui-route-contracts/ops-ui-v2-flag";
import { getPrivateStorageBucket } from "@/lib/config/env";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

const CONSOLE_BRAND_LOGO_TTL_SECONDS = 120;

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
  const organizationSettings = organizationSettingsFromAuth(auth);
  const logoUrl = await createConsoleBrandLogoSignedUrl(
    supabase,
    organizationSettings.brand.logoStoragePath,
  );
  const clientOrganizationSettings = {
    ...organizationSettings,
    brand: {
      ...organizationSettings.brand,
      logoStoragePath: null,
    },
    logoStoragePath: null,
    logoUrl,
  };

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

async function createConsoleBrandLogoSignedUrl(
  supabase: Awaited<ReturnType<typeof requireConsoleStaffAuth>>["supabase"],
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  try {
    const { data, error } = await supabase.storage
      .from(getPrivateStorageBucket())
      .createSignedUrl(path, CONSOLE_BRAND_LOGO_TTL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
  } catch {
    return null;
  }
}
