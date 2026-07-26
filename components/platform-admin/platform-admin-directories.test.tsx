import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  PlatformAuditDto,
  PlatformCostModelDto,
  PlatformOrderDto,
  PlatformOverviewDto,
  PlatformPlanPerformanceDto,
  PlatformUserDto,
} from "@/features/platform-admin/platform-admin-contracts";

import { AuditDirectory } from "./audit-directory";
import { CostModelDirectory } from "./cost-model-directory";
import { OrderDirectory } from "./order-directory";
import { OverviewDashboard } from "./overview-dashboard";
import { PlanDirectory } from "./plan-directory";
import { UserDirectory } from "./user-directory";

const overview: PlatformOverviewDto = {
  period: { start: "2026-07-01", end: "2026-07-31" },
  organizationCount: 12,
  payingOrganizationCount: 8,
  successfulOrderCount: 9,
  netRevenueCents: 880000,
  forecastRevenueCents: 960000,
  arpCents: 73333,
  computableContributionMarginCents: 310000,
  costCoverage: { covered: 10, total: 12 },
  expiry: { expired: 1, within7Days: 2, within30Days: 4 },
};

describe("OverviewDashboard", () => {
  it("shows revenue, ARP, expiry queue, and cost coverage", () => {
    render(<OverviewDashboard overview={overview} />);

    expect(screen.getByText("净实收")).toBeInTheDocument();
    expect(screen.getByText("订阅预测")).toBeInTheDocument();
    expect(screen.getByText("ARP")).toBeInTheDocument();
    expect(screen.getByText("到期队列")).toBeInTheDocument();
    expect(screen.getByText("成本覆盖")).toBeInTheDocument();
    expect(screen.getByText("10 / 12")).toBeInTheDocument();
  });
});

describe("UserDirectory", () => {
  const users: PlatformUserDto[] = [
    {
      membershipId: "member-a",
      organizationId: "org-a",
      organizationName: "安澜传媒",
      userId: "user-a",
      email: "owner@anlan.cn",
      name: "安澜负责人",
      role: "owner",
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      isPrimaryAccount: true,
    },
    {
      membershipId: "member-b",
      organizationId: "org-b",
      organizationName: "北辰工作室",
      userId: "user-b",
      email: "finance@beichen.cn",
      name: "北辰财务",
      role: "finance",
      status: "suspended",
      joinedAt: "2026-02-01T00:00:00.000Z",
      isPrimaryAccount: false,
    },
  ];

  it.each([
    ["北辰", "北辰财务", "安澜负责人"],
    ["主账号", "安澜负责人", "北辰财务"],
    ["财务", "北辰财务", "安澜负责人"],
    ["停用", "北辰财务", "安澜负责人"],
  ])("searches all account dimensions with %s", (query, visible, hidden) => {
    render(<UserDirectory users={users} total={users.length} />);

    fireEvent.change(screen.getByLabelText("搜索全部用户"), {
      target: { value: query },
    });

    expect(screen.getByText(visible)).toBeInTheDocument();
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  });
});

describe("PlanDirectory", () => {
  it("keeps commercial price separate from standard cost", () => {
    const plans: PlatformPlanPerformanceDto[] = [
      {
        id: "plan-pro",
        code: "pro",
        name: "专业版",
        tier: "pro",
        monthlyPriceCents: 299900,
        annualPriceCents: 2999000,
        activeSubscriptionCount: 8,
        payingOrganizationCount: 7,
        netRevenueCents: 780000,
        standardCostCents: 260000,
        contributionMarginCents: 520000,
      },
    ];

    render(<PlanDirectory plans={plans} />);

    expect(screen.getByText("套餐售价")).toBeInTheDocument();
    expect(screen.getByText("标准成本")).toBeInTheDocument();
    expect(screen.getByText("估算贡献毛利")).toBeInTheDocument();
  });
});

describe("OrderDirectory", () => {
  it("distinguishes paid, refunding, and refunded states", () => {
    const base: Omit<PlatformOrderDto, "id" | "status"> = {
      organizationId: "org-a",
      organizationName: "安澜传媒",
      kind: "subscription_new",
      amountCents: 10000,
      currency: "CNY",
      planName: "专业版",
      billingCycle: "monthly",
      provider: "offline",
      paidAt: "2026-07-20T00:00:00.000Z",
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    render(
      <OrderDirectory
        orders={[
          { ...base, id: "paid", status: "paid" },
          { ...base, id: "refunding", status: "refunding" },
          { ...base, id: "refunded", status: "refunded" },
        ]}
        total={3}
      />,
    );

    expect(screen.getByText("已支付")).toBeInTheDocument();
    expect(screen.getByText("退款处理中")).toBeInTheDocument();
    expect(screen.getByText("已退款")).toBeInTheDocument();
  });
});

describe("CostModelDirectory", () => {
  it("shows configured costs and missing metric coverage explicitly", () => {
    const costModels: PlatformCostModelDto[] = [
      {
        id: "cost-1",
        planId: "plan-pro",
        planName: "专业版",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
        fixedCostCents: 8000,
        perSeatCostCents: 1200,
        perActiveStreamerCostCents: 600,
        metricUnitCosts: { ai: 8 },
        reason: "季度云资源预算",
        coverageComplete: false,
      },
    ];

    render(<CostModelDirectory costModels={costModels} />);

    expect(screen.getByText("季度云资源预算")).toBeInTheDocument();
    expect(screen.getByText("成本项未完全配置")).toBeInTheDocument();
  });
});

describe("AuditDirectory", () => {
  it("shows reason, actor, target, summaries, trace, and result", () => {
    const audits: PlatformAuditDto[] = [
      {
        id: "audit-1",
        actorUserId: "admin-user",
        actorName: "平台管理员",
        action: "organization.freeze",
        targetType: "organization",
        targetId: "org-a",
        organizationId: "org-a",
        organizationName: "安澜传媒",
        reason: "合同款项逾期",
        isHighRisk: true,
        result: "success",
        errorMessage: null,
        traceId: "trace-001",
        beforeSummary: "组织状态：正常",
        afterSummary: "组织状态：已冻结",
        createdAt: "2026-07-25T08:00:00.000Z",
      },
    ];

    render(<AuditDirectory audits={audits} total={1} />);

    for (const text of [
      "合同款项逾期",
      "平台管理员",
      "安澜传媒",
      "组织状态：正常",
      "组织状态：已冻结",
      "trace-001",
      "成功",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});
