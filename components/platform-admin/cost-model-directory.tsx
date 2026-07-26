import { Badge } from "@/components/ui/badge";
import type { PlatformCostModelDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryEmpty, DirectoryHeader } from "./directory-primitives";
import { formatCurrencyCents, formatDateKey } from "./platform-admin-format";

export function CostModelDirectory({
  costModels,
}: {
  costModels: PlatformCostModelDto[];
}) {
  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="内部经营口径"
        title="成本模型"
        description="标准成本仅用于平台内部盈利估算，不会改变客户账单或主播结算金额。"
      />
      {costModels.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
              <tr>
                <th className="px-4 py-3 font-medium">套餐与生效期</th>
                <th className="px-4 py-3 font-medium">固定成本</th>
                <th className="px-4 py-3 font-medium">席位 / 主播</th>
                <th className="px-4 py-3 font-medium">计量成本项</th>
                <th className="px-4 py-3 font-medium">调整原因</th>
                <th className="px-4 py-3 font-medium">覆盖状态</th>
              </tr>
            </thead>
            <tbody>
              {costModels.map((model) => (
                <tr key={model.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <p className="font-medium">{model.planName}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-400)]">
                      {formatDateKey(model.effectiveFrom)} 至{" "}
                      {formatDateKey(model.effectiveTo) === "—"
                        ? "长期"
                        : formatDateKey(model.effectiveTo)}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCurrencyCents(model.fixedCostCents)}
                  </td>
                  <td className="px-4 py-3 text-xs leading-5">
                    <p>席位 {formatCurrencyCents(model.perSeatCostCents)}</p>
                    <p>
                      活跃主播{" "}
                      {formatCurrencyCents(model.perActiveStreamerCostCents)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {Object.keys(model.metricUnitCosts).length} 项
                  </td>
                  <td className="max-w-[260px] px-4 py-3">{model.reason}</td>
                  <td className="px-4 py-3">
                    <Badge tone={model.coverageComplete ? "green" : "amber"}>
                      {model.coverageComplete
                        ? "成本项完整"
                        : "成本项未完全配置"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DirectoryEmpty
          title="尚无标准成本"
          description="配置首个套餐成本版本后，才会开始计算估算贡献毛利。"
        />
      )}
    </div>
  );
}
