import { requireAuthenticatedUser } from "@/lib/auth/require-auth";

// 这个鉴权守卫只允许放在 (protected) 路由组里：/m/login 必须留在组外，
// 否则未登录访问登录页会被 redirect 回自身，形成无限 307 循环。
export default async function StreamerMobileProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthenticatedUser("/m/login");
  return children;
}
