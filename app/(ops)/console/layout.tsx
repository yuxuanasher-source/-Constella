import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { OpsShell } from "@/components/layouts/ops-shell";
import { unreadNotificationCount } from "@/features/projects/project-queries";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const context = await getAuthContext(supabase);
  const unreadCount = await unreadNotificationCount(supabase);

  return (
    <OpsShell
      context={context}
      unreadCount={unreadCount}
      activeHref="/console/projects"
    >
      {children}
    </OpsShell>
  );
}
