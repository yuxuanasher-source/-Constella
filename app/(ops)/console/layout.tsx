import { requireAuthenticatedUser } from "@/lib/auth/require-auth";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthenticatedUser("/login");
  return children;
}
