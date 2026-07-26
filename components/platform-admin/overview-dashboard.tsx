import { AlertTriangle, Building2, Clock3, WalletCards } from "lucide-react";

import type { PlatformOverviewDto } from "@/features/platform-admin/platform-admin-contracts";

import { DirectoryHeader } from "./directory-primitives";
import { formatCurrencyCents, formatInteger } from "./platform-admin-format";

export function OverviewDashboard({
  overview,
}: {
  overview: PlatformOverviewDto;
}) {
  const metrics = [
    {
      label: "净实收",
      value: formatCurrencyCents(overview.netRevenueCents),
      note: `${formatInteger(overview.successfulOrderCount)} 笔成功订单`,
    },
    {
      label: "订阅预测",
      value: formatCurrencyCents(overview.forecastRevenueCents),
      note: "按当前有效订阅价格估算",
    },
    {
      label: "ARP",
      value: formatCurrencyCents(overview.arpCents),
      note: `${formatInteger(overview.organizationCount)} 个未归档组织`,
    },
    {
      label: "估算贡献毛利",
      value: formatCurrencyCents(overview.computableContributionMarginCents),
      note: "仅统计成本配置完整的组织",
    },
  ];

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <DirectoryHeader
        eyebrow="平台经营"
        title="经营总览"
        description={`${overview.period.start} 至 ${overview.period.end}。实收、预测与标准成本估算保持独立口径。`}
      />

      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white px-4 py-4 shadow-[var(--shadow-card)]"
          >
            <dt className="text-xs font-medium text-[var(--ink-400)]">
              {metric.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
              {metric.value}
            </dd>
            <p className="mt-2 text-xs text-[var(--ink-400)]">{metric.note}</p>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock3
              aria-hidden="true"
              className="h-4 w-4 text-[var(--blue-600)]"
            />
            到期队列
          </h2>
          <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)]">
            <QueueCell
              label="已过期"
              value={overview.expiry.expired}
              tone="danger"
            />
            <QueueCell label="7 天内" value={overview.expiry.within7Days} />
            <QueueCell label="8–30 天" value={overview.expiry.within30Days} />
          </dl>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--ink-400)]">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn-600)]"
            />
            已过期组织应先核对收款和续费意向，再执行订阅调整。
          </p>
        </section>

        <section className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <WalletCards
              aria-hidden="true"
              className="h-4 w-4 text-[var(--blue-600)]"
            />
            成本覆盖
          </h2>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-semibold tabular-nums">
                {overview.costCoverage.covered} / {overview.costCoverage.total}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-400)]">
                已具备完整标准成本的组织
              </p>
            </div>
            <Building2
              aria-hidden="true"
              className="h-8 w-8 text-[var(--ink-200)]"
            />
          </div>
          <div
            role="progressbar"
            aria-label="成本模型覆盖率"
            aria-valuemin={0}
            aria-valuemax={overview.costCoverage.total}
            aria-valuenow={overview.costCoverage.covered}
            className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-50)]"
          >
            <div
              className="h-full bg-[var(--blue-600)]"
              style={{
                width: `${
                  overview.costCoverage.total === 0
                    ? 0
                    : (overview.costCoverage.covered /
                        overview.costCoverage.total) *
                      100
                }%`,
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function QueueCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="text-xs text-[var(--ink-400)]">{label}</dt>
      <dd
        className={
          tone === "danger"
            ? "mt-1 text-xl font-semibold text-[var(--danger-600)]"
            : "mt-1 text-xl font-semibold"
        }
      >
        {formatInteger(value)}
      </dd>
    </div>
  );
}
