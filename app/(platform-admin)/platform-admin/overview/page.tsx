import { OverviewDashboard } from "@/components/platform-admin/overview-dashboard";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import { loadPlatformOverview } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function OverviewPage() {
  const { actor, repo, period } = await getPlatformAdminPageData();
  const overview = await loadPlatformOverview({ repo, period });
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/overview"
      administratorName={actor.name}
    >
      <OverviewDashboard overview={overview} />
    </PlatformAdminShell>
  );
}
