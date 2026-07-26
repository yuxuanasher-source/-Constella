"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  OrganizationPageDto,
  PlatformAuditDto,
  PlatformOrganizationDetailDto,
  PlatformOrganizationListItemDto,
  PlatformOverviewDto,
  PlatformPlanPerformanceDto,
} from "@/features/platform-admin/platform-admin-contracts";
import { cn } from "@/lib/utils";

import {
  formatCurrencyCents,
  formatDateKey,
  formatInteger,
  lifecycleLabel,
  roleLabel,
  subscriptionStatusLabel,
} from "./platform-admin-format";
import {
  CreateOrganizationAction,
  MemberActions,
  OrganizationActions,
} from "./organization-actions";

const detailTabs = ["概览", "用户", "套餐", "订单", "操作记录"] as const;

export function OrganizationWorkspace({
  overview,
  initialPage,
  initialDetail,
  plans,
}: {
  overview: PlatformOverviewDto;
  initialPage: OrganizationPageDto;
  initialDetail: PlatformOrganizationDetailDto | null;
  plans: PlatformPlanPerformanceDto[];
}) {
  const [overviewData, setOverviewData] = useState(overview);
  const [page, setPage] = useState(initialPage);
  const [selectedId, setSelectedId] = useState(
    initialDetail?.id ?? initialPage.items[0]?.id ?? "",
  );
  const [detail, setDetail] = useState(initialDetail);
  const [tab, setTab] = useState<(typeof detailTabs)[number]>("概览");
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [planId, setPlanId] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [expiry, setExpiry] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditItems, setAuditItems] = useState<PlatformAuditDto[]>([]);
  const [refreshError, setRefreshError] = useState("");
  const firstFilterRun = useRef(true);

  const planOptions = useMemo(() => {
    return plans.map((plan) => [plan.id, plan.name] as [string, string]);
  }, [plans]);

  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshOrganizations(1);
    }, 320);
    return () => window.clearTimeout(timer);
    // refreshOrganizations intentionally reads the latest filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, lifecycle, planId, subscriptionStatus, expiry]);

  async function refreshOrganizations(targetPage: number) {
    setLoading(true);
    setRefreshError("");
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(page.meta.pageSize),
        start: overviewData.period.start,
        end: overviewData.period.end,
      });
      if (search.trim()) params.set("search", search.trim());
      if (lifecycle) params.set("lifecycleStatus", lifecycle);
      if (planId) params.set("planId", planId);
      if (expiry) params.set("expiry", expiry);

      const response = await fetch(
        `/api/platform-admin/organizations?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error("组织列表刷新失败");
      }
      const payload = (await response.json()) as {
        data: PlatformOrganizationListItemDto[];
        meta: OrganizationPageDto["meta"];
      };
      const filteredItems = subscriptionStatus
        ? payload.data.filter(
            (organization) =>
              organization.subscription?.status === subscriptionStatus,
          )
        : payload.data;
      setPage({ items: filteredItems, meta: payload.meta });
      if (
        filteredItems.length > 0 &&
        !filteredItems.some((organization) => organization.id === selectedId)
      ) {
        await selectOrganization(filteredItems[0].id);
      }
    } catch {
      setRefreshError("无法刷新组织列表，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function selectOrganization(
    organizationId: string,
    force = false,
    preserveTab = false,
  ) {
    setSelectedId(organizationId);
    if (!preserveTab) {
      setTab("概览");
    }
    if (!force && organizationId === initialDetail?.id) {
      setDetail(initialDetail);
      return;
    }
    setLoading(true);
    setRefreshError("");
    try {
      const params = new URLSearchParams({
        start: overviewData.period.start,
        end: overviewData.period.end,
      });
      const response = await fetch(
        `/api/platform-admin/organizations/${organizationId}?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error("组织详情加载失败");
      }
      const payload = (await response.json()) as {
        data: PlatformOrganizationDetailDto;
      };
      setDetail(payload.data);
    } catch {
      setRefreshError("无法加载组织详情，请重试。");
    } finally {
      setLoading(false);
    }
  }

  async function refreshWorkspace() {
    setLoading(true);
    setRefreshError("");
    try {
      const periodParams = new URLSearchParams({
        start: overviewData.period.start,
        end: overviewData.period.end,
      });
      const overviewResponse = await fetch(
        `/api/platform-admin/overview?${periodParams.toString()}`,
      );
      if (!overviewResponse.ok) {
        throw new Error("经营指标刷新失败");
      }
      const overviewPayload = (await overviewResponse.json()) as {
        data: PlatformOverviewDto;
      };
      setOverviewData(overviewPayload.data);
      await refreshOrganizations(page.meta.page);
      if (selectedId) {
        await selectOrganization(selectedId, true, true);
        if (tab === "操作记录") {
          await loadOrganizationAudit(selectedId);
        }
      }
    } catch {
      setRefreshError("操作已提交，但最新数据刷新失败，请手动刷新页面。");
    } finally {
      setLoading(false);
    }
  }

  async function loadOrganizationAudit(organizationId: string) {
    const params = new URLSearchParams({
      organizationId,
      page: "1",
      pageSize: "20",
      start: overviewData.period.start,
      end: overviewData.period.end,
    });
    const response = await fetch(
      `/api/platform-admin/audit?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error("操作记录加载失败");
    }
    const payload = (await response.json()) as {
      data: PlatformAuditDto[];
    };
    setAuditItems(payload.data);
  }

  function changeDetailTab(nextTab: (typeof detailTabs)[number]) {
    setTab(nextTab);
    if (nextTab === "操作记录" && selectedId) {
      void loadOrganizationAudit(selectedId).catch(() => {
        setRefreshError("无法加载该组织的操作记录，请稍后重试。");
      });
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[var(--blue-600)]">
            组织经营控制
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            组织与订阅
          </h1>
          <p className="mt-1 text-xs text-[var(--ink-400)]">
            {overviewData.period.start} 至 {overviewData.period.end}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={overviewData.expiry.expired > 0 ? "red" : "neutral"}>
            {overviewData.expiry.expired > 0
              ? `${overviewData.expiry.expired} 个组织已到期`
              : "暂无已到期组织"}
          </Badge>
          <CreateOrganizationAction
            plans={plans}
            period={overviewData.period}
            onSuccess={refreshWorkspace}
          />
        </div>
      </div>

      <OverviewBand overview={overviewData} />

      <section className="mt-4 grid min-h-[660px] overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)] lg:grid-cols-[350px_minmax(0,1fr)]">
        <div className="border-b border-[var(--line)] lg:border-r lg:border-b-0">
          <div className="space-y-3 border-b border-[var(--line)] p-3">
            <label className="relative block">
              <span className="sr-only">搜索组织</span>
              <Search
                aria-hidden="true"
                className="absolute top-2.5 left-3 h-4 w-4 text-[var(--ink-300)]"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索组织名称或编码"
                className="h-9 w-full rounded-md border border-[var(--line)] bg-white pr-3 pl-9 text-sm outline-none focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect
                label="组织状态"
                value={lifecycle}
                onChange={setLifecycle}
                options={[
                  ["active", "正常"],
                  ["frozen", "已冻结"],
                  ["archived", "已归档"],
                ]}
              />
              <FilterSelect
                label="套餐"
                value={planId}
                onChange={setPlanId}
                options={planOptions}
              />
              <FilterSelect
                label="订阅状态"
                value={subscriptionStatus}
                onChange={setSubscriptionStatus}
                options={[
                  ["active", "生效中"],
                  ["trialing", "试用中"],
                  ["past_due", "已逾期"],
                  ["readonly", "只读"],
                  ["cancelled", "已取消"],
                ]}
              />
              <FilterSelect
                label="到期时间"
                value={expiry}
                onChange={setExpiry}
                options={[
                  ["expired", "已过期"],
                  ["within7Days", "7 天内"],
                  ["within30Days", "8–30 天"],
                ]}
              />
            </div>
            <label className="block lg:hidden">
              <span className="sr-only">选择组织</span>
              <select
                aria-label="选择组织"
                value={selectedId}
                onChange={(event) =>
                  void selectOrganization(event.target.value)
                }
                className="h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm"
              >
                {page.items.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="hidden max-h-[510px] overflow-y-auto lg:block">
            {page.items.length > 0 ? (
              page.items.map((organization) => (
                <OrganizationRow
                  key={organization.id}
                  organization={organization}
                  selected={organization.id === selectedId}
                  onSelect={() => void selectOrganization(organization.id)}
                />
              ))
            ) : (
              <EmptyOrganizationList />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2">
            <span className="text-xs text-[var(--ink-400)]">
              共 {formatInteger(page.meta.total)} 个组织
            </span>
            <div className="flex gap-1">
              <Button
                aria-label="上一页"
                variant="ghost"
                size="icon"
                disabled={loading || page.meta.page <= 1}
                onClick={() => void refreshOrganizations(page.meta.page - 1)}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                aria-label="下一页"
                variant="ghost"
                size="icon"
                disabled={
                  loading ||
                  page.meta.page * page.meta.pageSize >= page.meta.total
                }
                onClick={() => void refreshOrganizations(page.meta.page + 1)}
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {detail ? (
            <OrganizationDetail
              detail={detail}
              plans={plans}
              auditItems={auditItems}
              activeTab={tab}
              onTabChange={changeDetailTab}
              onSuccess={refreshWorkspace}
            />
          ) : (
            <EmptyOrganizations />
          )}
        </div>
      </section>

      <p
        aria-live="polite"
        className="mt-3 min-h-5 text-xs text-[var(--danger-600)]"
      >
        {refreshError}
      </p>
    </div>
  );
}

function OverviewBand({ overview }: { overview: PlatformOverviewDto }) {
  const items = [
    ["当前组织", formatInteger(overview.organizationCount)],
    ["付费组织", formatInteger(overview.payingOrganizationCount)],
    ["实收", formatCurrencyCents(overview.netRevenueCents)],
    ["预测", formatCurrencyCents(overview.forecastRevenueCents)],
    ["ARP", formatCurrencyCents(overview.arpCents)],
    [
      "标准估算",
      `${formatCurrencyCents(overview.computableContributionMarginCents)} · ${overview.costCoverage.covered}/${overview.costCoverage.total}`,
    ],
  ];
  return (
    <dl className="grid overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-6">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="border-b border-[var(--line)] px-4 py-3 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-r lg:border-b-0 lg:last:border-r-0"
        >
          <dt className="text-[11px] font-medium text-[var(--ink-400)]">
            {label}
          </dt>
          <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrganizationRow({
  organization,
  selected,
  onSelect,
}: {
  organization: PlatformOrganizationListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${organization.name}，${lifecycleLabel(organization.lifecycleStatus)}`}
      onClick={onSelect}
      className={cn(
        "block w-full border-b border-[var(--line)] px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--blue-300)]",
        selected ? "bg-[var(--blue-50)]" : "bg-white hover:bg-[var(--bg-soft)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{organization.name}</p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-400)]">
            {organization.code} · {organization.memberCount} 位用户
          </p>
        </div>
        <Badge
          tone={
            organization.lifecycleStatus === "active"
              ? "green"
              : organization.lifecycleStatus === "frozen"
                ? "amber"
                : "neutral"
          }
        >
          {lifecycleLabel(organization.lifecycleStatus)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-[var(--ink-500)]">
          {organization.subscription?.plan.name ?? "未配置套餐"}
        </span>
        <span className="tabular-nums text-[var(--ink-400)]">
          {formatDateKey(organization.subscription?.currentPeriodEnd)}
        </span>
      </div>
    </button>
  );
}

function OrganizationDetail({
  detail,
  plans,
  auditItems,
  activeTab,
  onTabChange,
  onSuccess,
}: {
  detail: PlatformOrganizationDetailDto;
  plans: PlatformPlanPerformanceDto[];
  auditItems: PlatformAuditDto[];
  activeTab: (typeof detailTabs)[number];
  onTabChange: (tab: (typeof detailTabs)[number]) => void;
  onSuccess: () => void | Promise<void>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{detail.name}</h2>
            <Badge
              tone={detail.lifecycleStatus === "active" ? "green" : "amber"}
            >
              {lifecycleLabel(detail.lifecycleStatus)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-400)]">
            {detail.code} · 创建于 {formatDateKey(detail.createdAt)}
          </p>
        </div>
        <OrganizationActions
          organization={detail}
          plans={plans}
          onSuccess={onSuccess}
        />
      </div>

      <div
        role="tablist"
        aria-label="组织详情"
        className="flex overflow-x-auto border-b border-[var(--line)] px-4"
      >
        {detailTabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={activeTab === item}
            onClick={() => onTabChange(item)}
            className={cn(
              "h-11 shrink-0 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-300)]",
              activeTab === item
                ? "border-[var(--blue-600)] text-[var(--blue-700)]"
                : "border-transparent text-[var(--ink-400)] hover:text-[var(--ink-700)]",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="p-5">
        {activeTab === "概览" ? <OrganizationOverview detail={detail} /> : null}
        {activeTab === "用户" ? (
          <OrganizationUsers detail={detail} onSuccess={onSuccess} />
        ) : null}
        {activeTab === "套餐" ? <OrganizationPlan detail={detail} /> : null}
        {activeTab === "订单" ? <OrganizationOrders detail={detail} /> : null}
        {activeTab === "操作记录" ? (
          <OrganizationAudit items={auditItems} />
        ) : null}
      </div>
    </>
  );
}

function OrganizationAudit({ items }: { items: PlatformAuditDto[] }) {
  return items.length > 0 ? (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
          <tr>
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">操作</th>
            <th className="px-3 py-2 font-medium">原因</th>
            <th className="px-3 py-2 font-medium">管理员</th>
            <th className="px-3 py-2 font-medium">结果</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-3 text-xs tabular-nums">
                {item.createdAt.slice(0, 16).replace("T", " ")}
              </td>
              <td className="px-3 py-3 font-mono text-xs">{item.action}</td>
              <td className="max-w-[280px] px-3 py-3">
                {item.reason ?? "未记录原因"}
              </td>
              <td className="px-3 py-3">{item.actorName}</td>
              <td className="px-3 py-3">
                <Badge tone={item.result === "success" ? "green" : "red"}>
                  {item.result === "success" ? "成功" : "失败"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="暂无操作记录"
      description="该组织在当前周期内还没有受治理的管理操作。"
    />
  );
}

function OrganizationOverview({
  detail,
}: {
  detail: PlatformOrganizationDetailDto;
}) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
        <MetricCell
          label="实收"
          value={formatCurrencyCents(detail.metrics.netRevenueCents)}
        />
        <MetricCell
          label="标准估算"
          value={
            detail.metrics.costCents === null
              ? "成本未配置"
              : formatCurrencyCents(detail.metrics.costCents)
          }
        />
        <MetricCell
          label="估算贡献毛利"
          value={formatCurrencyCents(detail.metrics.contributionMarginCents)}
        />
      </dl>

      <div className="grid gap-4 xl:grid-cols-2">
        <InfoPanel title="主账号与组织构成" icon={Users}>
          {detail.primaryAccount.status === "confirmed" ? (
            <div>
              <p className="font-medium">{detail.primaryAccount.name}</p>
              <p className="mt-1 text-xs text-[var(--ink-400)]">
                {detail.primaryAccount.email}
              </p>
              <Badge className="mt-3" tone="blue">
                主账号
              </Badge>
            </div>
          ) : (
            <div className="text-sm text-[var(--warn-600)]">
              主账号待人工确认
            </div>
          )}
          <p className="mt-4 text-xs text-[var(--ink-400)]">
            当前共 {detail.memberCount} 位组织成员
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Badge tone="neutral">子账号</Badge>
            <span className="text-xs text-[var(--ink-400)]">
              {Math.max(detail.memberCount - 1, 0)} 个
            </span>
          </div>
        </InfoPanel>

        <InfoPanel title="当前套餐" icon={CalendarClock}>
          {detail.subscription ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{detail.subscription.plan.name}</p>
                <Badge tone="green">
                  {subscriptionStatusLabel(detail.subscription.status)}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-[var(--ink-400)]">
                {formatDateKey(detail.subscription.currentPeriodStart)} 至{" "}
                {formatDateKey(detail.subscription.currentPeriodEnd)} ·{" "}
                {detail.subscription.billingCycle === "annual"
                  ? "年付"
                  : "月付"}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--ink-400)]">尚未配置套餐</p>
          )}
        </InfoPanel>
      </div>
    </div>
  );
}

function OrganizationUsers({
  detail,
  onSuccess,
}: {
  detail: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  return (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
          <tr>
            <th className="px-3 py-2 font-medium">账号</th>
            <th className="px-3 py-2 font-medium">账号类型</th>
            <th className="px-3 py-2 font-medium">角色</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">管理</th>
          </tr>
        </thead>
        <tbody>
          {detail.members.map((member) => (
            <tr
              key={member.membershipId}
              className="border-t border-[var(--line)]"
            >
              <td className="px-3 py-3">
                <p className="font-medium">{member.name}</p>
                <p className="text-xs text-[var(--ink-400)]">{member.email}</p>
              </td>
              <td className="px-3 py-3">
                <Badge tone={member.isPrimaryAccount ? "blue" : "neutral"}>
                  {member.isPrimaryAccount ? "主账号" : "子账号"}
                </Badge>
              </td>
              <td className="px-3 py-3">{roleLabel(member.role)}</td>
              <td className="px-3 py-3">
                {member.status === "active" ? "正常" : member.status}
              </td>
              <td className="px-3 py-3">
                <MemberActions
                  organizationId={detail.id}
                  member={member}
                  onSuccess={onSuccess}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrganizationPlan({
  detail,
}: {
  detail: PlatformOrganizationDetailDto;
}) {
  return detail.subscription ? (
    <dl className="grid gap-4 sm:grid-cols-2">
      <InfoValue label="套餐名称" value={detail.subscription.plan.name} />
      <InfoValue
        label="订阅状态"
        value={subscriptionStatusLabel(detail.subscription.status)}
      />
      <InfoValue
        label="计费周期"
        value={detail.subscription.billingCycle === "annual" ? "年付" : "月付"}
      />
      <InfoValue
        label="到期日期"
        value={formatDateKey(detail.subscription.currentPeriodEnd)}
      />
    </dl>
  ) : (
    <EmptyState
      title="尚未配置套餐"
      description="可通过后续管理操作创建订阅。"
    />
  );
}

function OrganizationOrders({
  detail,
}: {
  detail: PlatformOrganizationDetailDto;
}) {
  return detail.recentOrders.length > 0 ? (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-500)]">
          <tr>
            <th className="px-3 py-2 font-medium">订单</th>
            <th className="px-3 py-2 font-medium">金额</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">支付时间</th>
          </tr>
        </thead>
        <tbody>
          {detail.recentOrders.map((order) => (
            <tr key={order.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-3 font-mono text-xs">{order.id}</td>
              <td className="px-3 py-3 tabular-nums">
                {formatCurrencyCents(order.amountCents)}
              </td>
              <td className="px-3 py-3">{order.status}</td>
              <td className="px-3 py-3">{formatDateKey(order.paidAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="暂无订单"
      description="该组织在当前视图中没有可展示的订单。"
    />
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="text-xs text-[var(--ink-400)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function InfoPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[var(--line)] p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="h-4 w-4 text-[var(--blue-600)]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] px-4 py-3">
      <dt className="text-xs text-[var(--ink-400)]">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-xs text-[var(--ink-500)] outline-none focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
      >
        <option value="">{label}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyOrganizations() {
  return (
    <EmptyState
      title="尚无组织"
      description="创建首个组织后，组织构成与订阅状态将在这里展示。"
    />
  );
}

function EmptyOrganizationList() {
  return (
    <EmptyState
      title="组织列表为空"
      description="调整筛选条件，或创建首个组织后再查看。"
    />
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
      <div>
        <Building2
          aria-hidden="true"
          className="mx-auto h-6 w-6 text-[var(--ink-300)]"
        />
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--ink-400)]">
          {description}
        </p>
      </div>
    </div>
  );
}
