import { OrganizationWorkspace } from "@/components/platform-admin/organization-workspace";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import {
  getPlatformOrganizationDetail,
  listPlatformOrganizations,
  loadPlatformOverview,
} from "@/features/platform-admin/platform-admin-read-service";
import { SupabasePlatformAdminRepository } from "@/features/platform-admin/platform-admin-repository-supabase";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import { requirePlatformAdminPage } from "../platform-admin-auth";

export default async function OrganizationsPage() {
  const actor = await requirePlatformAdminPage();
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error("Platform administration service is unavailable.");
  }
  const repo = new SupabasePlatformAdminRepository(admin);
  const period = currentNaturalMonth();
  const [overview, organizations] = await Promise.all([
    loadPlatformOverview({ repo, period }),
    listPlatformOrganizations({
      repo,
      query: { page: 1, pageSize: 20, period },
    }),
  ]);
  const firstOrganization = organizations.items[0];
  const detail = firstOrganization
    ? await getPlatformOrganizationDetail({
        repo,
        organizationId: firstOrganization.id,
        period,
      })
    : null;

  return (
    <PlatformAdminShell
      currentPath="/platform-admin/organizations"
      administratorName={actor.name}
    >
      <OrganizationWorkspace
        overview={overview}
        initialPage={organizations}
        initialDetail={detail}
      />
    </PlatformAdminShell>
  );
}

function currentNaturalMonth() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}
