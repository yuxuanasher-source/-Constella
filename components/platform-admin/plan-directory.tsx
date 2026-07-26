"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { PlatformPlanPerformanceDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryEmpty, DirectoryHeader } from "./directory-primitives";
import { formatCurrencyCents } from "./platform-admin-format";
import { PlanActions } from "./plan-actions";

export function PlanDirectory({
  plans,
}: {
  plans: PlatformPlanPerformanceDto[];
}) {
  const router = useRouter();

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="商业化配置"
        title="套餐"
        description="售价来自套餐价格版本；标准成本来自内部成本模型，两者不互相覆盖。"
      />
      {plans.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
              <tr>
                <th className="px-4 py-3 font-medium">套餐</th>
                <th className="px-4 py-3 font-medium">套餐售价</th>
                <th className="px-4 py-3 font-medium">有效订阅</th>
                <th className="px-4 py-3 font-medium">净实收</th>
                <th className="px-4 py-3 font-medium">标准成本</th>
                <th className="px-4 py-3 font-medium">估算贡献毛利</th>
                <th className="px-4 py-3 font-medium">管理</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <p className="font-medium">{plan.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-400)]">
                      {plan.code}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="tabular-nums">
                      月付 {formatCurrencyCents(plan.monthlyPriceCents)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-400)] tabular-nums">
                      年付 {formatCurrencyCents(plan.annualPriceCents)}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {plan.activeSubscriptionCount}
                    <span className="ml-1 text-xs text-[var(--ink-400)]">
                      （付费 {plan.payingOrganizationCount}）
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCurrencyCents(plan.netRevenueCents)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {plan.standardCostCents === null ? (
                      <Badge tone="amber">成本未配置</Badge>
                    ) : (
                      formatCurrencyCents(plan.standardCostCents)
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {formatCurrencyCents(plan.contributionMarginCents)}
                  </td>
                  <td className="px-4 py-3">
                    <PlanActions
                      plan={plan}
                      onSuccess={() => router.refresh()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DirectoryEmpty
          title="尚无套餐"
          description="创建套餐与价格版本后将在这里展示经营表现。"
        />
      )}
    </div>
  );
}
