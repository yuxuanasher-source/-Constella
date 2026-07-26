import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";
import { UserDirectory } from "@/components/platform-admin/user-directory";
import { listPlatformUsers } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function UsersPage() {
  const { actor, repo } = await getPlatformAdminPageData();
  const users = await listPlatformUsers({
    repo,
    query: { page: 1, pageSize: 50 },
  });
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/users"
      administratorName={actor.name}
    >
      <UserDirectory users={users.items} total={users.meta.total} />
    </PlatformAdminShell>
  );
}
