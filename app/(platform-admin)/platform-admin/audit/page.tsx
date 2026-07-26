import { AuditDirectory } from "@/components/platform-admin/audit-directory";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import { listPlatformAudit } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function AuditPage() {
  const { actor, repo, period } = await getPlatformAdminPageData();
  const audits = await listPlatformAudit({
    repo,
    query: { page: 1, pageSize: 50, period },
  });
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/audit"
      administratorName={actor.name}
    >
      <AuditDirectory audits={audits.items} total={audits.meta.total} />
    </PlatformAdminShell>
  );
}
