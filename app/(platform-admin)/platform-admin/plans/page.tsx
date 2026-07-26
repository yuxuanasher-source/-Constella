import { PlanDirectory } from "@/components/platform-admin/plan-directory";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import { listPlatformPlans } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function PlansPage() {
  const { actor, repo, period } = await getPlatformAdminPageData();
  const plans = await listPlatformPlans({ repo, period });
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/plans"
      administratorName={actor.name}
    >
      <PlanDirectory plans={plans} />
    </PlatformAdminShell>
  );
}
