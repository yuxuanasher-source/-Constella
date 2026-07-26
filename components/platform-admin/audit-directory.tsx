import { Badge } from "@/components/ui/badge";
import type { PlatformAuditDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryEmpty, DirectoryHeader } from "./directory-primitives";
import { formatDateKey } from "./platform-admin-format";

export function AuditDirectory({
  audits,
  total,
}: {
  audits: PlatformAuditDto[];
  total: number;
}) {
  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="高风险治理"
        title="操作审计"
        description="追踪平台管理员对组织、账号、套餐、订单和成本模型执行的操作。"
        trailing={
          <span className="text-xs text-[var(--ink-400)]">
            共 {total} 条记录
          </span>
        }
      />
      {audits.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
              <tr>
                <th className="px-4 py-3 font-medium">时间 / 操作人</th>
                <th className="px-4 py-3 font-medium">动作与目标</th>
                <th className="px-4 py-3 font-medium">原因</th>
                <th className="px-4 py-3 font-medium">变更前</th>
                <th className="px-4 py-3 font-medium">变更后</th>
                <th className="px-4 py-3 font-medium">追踪与结果</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((audit) => (
                <tr key={audit.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <p>{audit.actorName}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-400)]">
                      {formatDateKey(audit.createdAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{audit.action}</p>
                    <p className="mt-1 text-xs text-[var(--ink-400)]">
                      {audit.organizationName ??
                        audit.targetId ??
                        audit.targetType}
                    </p>
                  </td>
                  <td className="max-w-[240px] px-4 py-3">
                    {audit.reason ?? "—"}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 text-xs leading-5">
                    {audit.beforeSummary}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 text-xs leading-5">
                    {audit.afterSummary}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={audit.result === "success" ? "green" : "red"}>
                      {audit.result === "success" ? "成功" : "失败"}
                    </Badge>
                    <p className="mt-2 font-mono text-[11px] text-[var(--ink-400)]">
                      {audit.traceId}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <DirectoryEmpty
          title="暂无操作记录"
          description="平台管理员执行受治理操作后，记录将在这里展示。"
        />
      )}
    </div>
  );
}
