import { requirePlatformAdminPage } from "./platform-admin-auth";

export const dynamic = "force-dynamic";

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdminPage();
  return children;
}
