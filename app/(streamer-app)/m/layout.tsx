import { requireAuthenticatedUser } from "@/lib/auth/require-auth";

export default async function StreamerMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthenticatedUser("/m/login");
  return children;
}
