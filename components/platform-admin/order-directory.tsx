"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { PlatformOrderDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryEmpty, DirectoryHeader } from "./directory-primitives";
import { formatCurrencyCents, formatDateKey } from "./platform-admin-format";
import { PaymentActions } from "./payment-actions";

export function OrderDirectory({
  orders,
  total,
}: {
  orders: PlatformOrderDto[];
  total: number;
}) {
  const router = useRouter();

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="平台收款"
        title="订单与付款"
        description="这里只展示组织向平台支付的订阅与增购订单，不包含主播结算出款。"
        trailing={
          <span className="text-xs text-[var(--ink-400)]">
            共 {total} 笔订单
          </span>
        }
      />
      {orders.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
              <tr>
                <th className="px-4 py-3 font-medium">订单</th>
                <th className="px-4 py-3 font-medium">组织</th>
                <th className="px-4 py-3 font-medium">套餐</th>
                <th className="px-4 py-3 font-medium">金额</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">收款时间</th>
                <th className="px-4 py-3 font-medium">管理</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const status = orderStatus(order.status);
                return (
                  <tr key={order.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs">{order.id}</p>
                      <p className="mt-0.5 text-xs text-[var(--ink-400)]">
                        {order.provider ?? "未记录渠道"}
                      </p>
                    </td>
                    <td className="px-4 py-3">{order.organizationName}</td>
                    <td className="px-4 py-3">{order.planName ?? "增购项"}</td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {formatCurrencyCents(order.amountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--ink-500)]">
                      {formatDateKey(order.paidAt ?? order.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentActions
                        order={order}
                        onSuccess={() => router.refresh()}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <DirectoryEmpty
          title="当前周期暂无订单"
          description="调整日期范围或组织筛选后重试。"
        />
      )}
    </div>
  );
}

function orderStatus(status: string): {
  label: string;
  tone: "neutral" | "green" | "amber" | "red";
} {
  return (
    {
      pending: { label: "待支付", tone: "neutral" as const },
      paid: { label: "已支付", tone: "green" as const },
      failed: { label: "失败", tone: "red" as const },
      cancelled: { label: "已取消", tone: "neutral" as const },
      refunding: { label: "退款处理中", tone: "amber" as const },
      refunded: { label: "已退款", tone: "red" as const },
    }[status] ?? { label: status, tone: "neutral" as const }
  );
}
