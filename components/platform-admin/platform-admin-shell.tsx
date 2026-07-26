import Link from "next/link";
import {
  Building2,
  ClipboardList,
  CreditCard,
  Gauge,
  Package,
  ReceiptText,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";

import { cn } from "@/lib/utils";

const navigation = [
  { href: "/platform-admin/overview", label: "经营总览", icon: Gauge },
  {
    href: "/platform-admin/organizations",
    label: "组织",
    icon: Building2,
  },
  { href: "/platform-admin/users", label: "全部用户", icon: Users },
  { href: "/platform-admin/plans", label: "套餐", icon: Package },
  {
    href: "/platform-admin/orders",
    label: "订单与付款",
    icon: CreditCard,
  },
  {
    href: "/platform-admin/cost-models",
    label: "成本模型",
    icon: WalletCards,
  },
  {
    href: "/platform-admin/audit",
    label: "操作审计",
    icon: ClipboardList,
  },
];

export function PlatformAdminShell({
  currentPath,
  administratorName,
  children,
}: {
  currentPath: string;
  administratorName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink-900)] lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="border-b border-[var(--line)] bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[var(--blue-600)] text-white">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">平台管理后台</p>
            <p className="text-[11px] text-[var(--ink-400)]">
              Platform Operations
            </p>
          </div>
        </div>

        <nav
          aria-label="平台管理导航"
          className="flex gap-1 overflow-x-auto px-3 py-3 lg:block lg:space-y-1"
        >
          {navigation.map((item) => {
            const active =
              currentPath === item.href ||
              currentPath.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--blue-300)]",
                  active
                    ? "bg-[var(--blue-50)] text-[var(--blue-700)]"
                    : "text-[var(--ink-500)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink-900)]",
                )}
              >
                <item.icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden border-t border-[var(--line)] p-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--ink-900)] text-xs font-semibold text-white">
              {administratorName.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {administratorName}
              </p>
              <p className="text-[11px] text-[var(--ink-400)]">超级管理员</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="flex h-16 items-center justify-between border-b border-[var(--line)] bg-white px-5 lg:px-7">
          <div className="flex items-center gap-2 text-xs text-[var(--ink-400)]">
            <ReceiptText aria-hidden="true" className="h-4 w-4" />
            平台经营与订阅控制台
          </div>
          <div className="text-xs text-[var(--ink-500)]">
            {administratorName}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
