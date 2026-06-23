import { AccountLibraryPanel } from "@/components/account-library/account-library-panel";
import { AccountLibraryShell } from "@/components/account-library/account-library-shell";
import { listPlatformAccounts } from "@/features/account-library/account-library-queries";
import {
  canManageAccounts,
  type AccountLibraryActor,
} from "@/features/account-library/account-library-service";
import { toPlatformAccountDtos } from "@/features/account-library/account-library-ui-adapters";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { getUnreadNotificationCount } from "@/lib/notify/unread-count";
import { isMcnStaff } from "@/lib/rbac/roles";

export default async function AccountLibraryPage() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  const unreadCount = await getUnreadNotificationCount(supabase, auth);

  const canView = Boolean(auth && isMcnStaff(auth.role));
  const accounts =
    supabase && canView ? await listPlatformAccounts(supabase) : [];
  const dtos = auth ? toPlatformAccountDtos(accounts, auth.role) : [];
  const canManage = Boolean(
    auth && canManageAccounts((auth as AccountLibraryActor).role),
  );

  return (
    <AccountLibraryShell
      orgName={auth?.organizationName ?? "未连接组织"}
      userName={auth?.name ?? "访客"}
      role={auth?.role ?? "guest"}
      unreadCount={unreadCount}
    >
      {canView ? (
        <AccountLibraryPanel accounts={dtos} canManage={canManage} />
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-white p-10 text-center text-[var(--ink-300)]">
          需要经营端角色才能访问账号库。
        </div>
      )}
    </AccountLibraryShell>
  );
}
