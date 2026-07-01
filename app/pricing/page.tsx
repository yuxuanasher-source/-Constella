import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import {
  resolvePublicPricingPlans,
  type PublicPricingPlan,
} from "./pricing-data";

export const dynamic = "force-dynamic";

function yuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN")}`;
}

export default async function PricingPage() {
  const client =
    createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  const { data: plans } = client
    ? await client
        .from("billing_plans")
        .select(
          "id, code, name, monthly_price_cents, annual_price_cents, included_active_streamers, included_seats, included_ocr, included_ai",
        )
        .order("monthly_price_cents", { ascending: true })
        .returns<PublicPricingPlan[]>()
    : { data: [] as PublicPricingPlan[] };
  const publicPlans = resolvePublicPricingPlans(plans);

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <BrandLogo />
          <Link href="/signup">
            <Button>免费试用</Button>
          </Link>
        </div>

        <h1 className="mt-10 text-3xl font-semibold text-[var(--ink-900)]">
          选择适合你的套餐
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-500)]">
          所有套餐均支持 14 天免费试用，按月或按年订阅，随时升级。
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {publicPlans.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col rounded-lg border border-[var(--line)] bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-[var(--ink-900)]">
                {plan.name}
              </h2>
              <p className="mt-3 text-2xl font-semibold text-[var(--ink-900)]">
                {yuan(plan.monthly_price_cents)}
                <span className="text-sm font-normal text-[var(--ink-500)]">
                  {" "}
                  / 月
                </span>
              </p>
              <p className="mt-1 text-xs text-[var(--ink-500)]">
                按年 {yuan(plan.annual_price_cents)} / 年
              </p>
              <ul className="mt-4 space-y-2 text-sm text-[var(--ink-700)]">
                <li>活跃主播 {plan.included_active_streamers} 位</li>
                <li>团队席位 {plan.included_seats} 个</li>
                <li>OCR {plan.included_ocr} 次 / 月</li>
                <li>AI {plan.included_ai} 次 / 月</li>
              </ul>
              <div className="mt-6 flex-1" />
              <Link href="/signup">
                <Button className="w-full">开始试用</Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
