import Link from "next/link";
import {
  Bell,
  Building2,
  ChevronDown,
  LayoutDashboard,
  Search,
} from "lucide-react";

import { signOutAction } from "@/app/(auth)/login/actions";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { OPS_MODULE_ROUTES } from "@/features/ui-route-contracts/module-route-map";
import type { AuthContext } from "@/lib/auth/context";
import { cn } from "@/lib/utils";

export function OpsShell({
  children,
  context,
  unreadCount,
  activeHref,
}: {
  children: React.ReactNode;
  context: AuthContext | null;
  unreadCount: number;
  activeHref?: string;
}) {
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink-900)]">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--line)] bg-white px-4 py-5 lg:block">
        <BrandLogo />
        <nav className="mt-8 space-y-1">
          {OPS_MODULE_ROUTES.map(({ module, label, href }) => {
            const code = module.toUpperCase();
            const displayLabel = label.startsWith(`${code} `)
              ? label.slice(code.length + 1)
              : label;

            return (
              <Link
                key={module}
                href={href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-sm text-[var(--ink-500)] transition-colors hover:bg-[var(--blue-50)] hover:text-[var(--blue-700)]",
                  activeHref === href &&
                    "bg-[var(--blue-50)] font-medium text-[var(--blue-700)]",
                )}
              >
                <span className="w-9 font-mono text-xs tabular-nums">
                  {code}
                </span>
                <span>{displayLabel}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-[var(--line)] bg-white/95 px-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="h-5 w-5 text-[var(--blue-600)]" />
            <div>
              <div className="text-sm font-semibold">经营 Web 端</div>
              <div className="text-xs text-[var(--ink-300)]">
                {context?.organizationName ?? "未连接组织"}
              </div>
            </div>
          </div>

          <div className="hidden h-9 w-80 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm text-[var(--ink-300)] md:flex">
            <Search className="h-4 w-4" />
            <span>搜索项目、主播、任务</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="relative grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-white text-[var(--ink-500)]"
              title="通知"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--danger-600)] px-1 text-[10px] font-semibold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </button>
            <div className="hidden items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm md:flex">
              <Building2 className="h-4 w-4 text-[var(--ink-300)]" />
              <span>{context?.role ?? "guest"}</span>
              <ChevronDown className="h-4 w-4 text-[var(--ink-300)]" />
            </div>
            {context ? (
              <form action={signOutAction}>
                <Button variant="secondary" size="sm">
                  退出
                </Button>
              </form>
            ) : (
              <Button asChild size="sm">
                <Link href="/login">登录</Link>
              </Button>
            )}
          </div>
        </header>
        <main className="px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
