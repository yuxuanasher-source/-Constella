import { BarChart3, ClipboardList, MonitorDot, UserRound } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";

const tabs = [
  ["任务", ClipboardList, "/m/tasks"],
  ["录屏", MonitorDot, "/m/recordings"],
  ["诊断", BarChart3, "/m/diagnosis"],
  ["我", UserRound, "/m/me"],
] as const;

export default function StreamerMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-[var(--bg)]">
      <header className="border-b border-[var(--line)] bg-white px-4 py-4">
        <BrandLogo />
      </header>
      <main className="flex-1 px-4 py-5">{children}</main>
      <nav className="grid grid-cols-4 border-t border-[var(--line)] bg-white">
        {tabs.map(([label, Icon, href]) => (
          <Link
            key={label}
            href={href}
            className="flex h-16 flex-col items-center justify-center gap-1 text-xs text-[var(--ink-500)]"
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
