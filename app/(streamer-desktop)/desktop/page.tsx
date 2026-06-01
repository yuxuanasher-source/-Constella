import { Monitor, WalletCards } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";

export default function StreamerDesktopPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <header className="flex h-16 items-center justify-between border-b border-[var(--line)] bg-white px-6">
        <BrandLogo />
        <Badge tone="blue">主播桌面端</Badge>
      </header>
      <section className="mx-auto grid max-w-6xl gap-5 px-6 py-6 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-[var(--line)] bg-white p-6">
          <div className="flex items-center gap-2 text-[var(--blue-700)]">
            <Monitor className="h-5 w-5" />
            <span className="text-sm font-medium">桌面工作台</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">待办与录屏库外壳</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-500)]">
            桌面端用于收入趋势、待办、录屏库和脚本调优，本期保留布局入口。
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white p-6">
          <div className="flex items-center gap-2 text-[var(--ok-600)]">
            <WalletCards className="h-5 w-5" />
            <span className="text-sm font-medium">安全应付视图</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-500)]">
            主播端未来只读取 `streamer_payable_items_safe`，不暴露厂家应收、毛利和成本。
          </p>
        </div>
      </section>
    </main>
  );
}
