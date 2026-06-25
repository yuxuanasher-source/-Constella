import { requireAuthenticatedUser } from "@/lib/auth/require-auth";

// 经营台所有页面都依赖登录会话（cookie）渲染真实数据。强制动态渲染，
// 避免构建期被静态预渲染成「未登录空壳」——否则首次登录会看到空数据、
// 需多次刷新才命中真实渲染（尤其项目明细）。
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthenticatedUser("/login");
  return children;
}
