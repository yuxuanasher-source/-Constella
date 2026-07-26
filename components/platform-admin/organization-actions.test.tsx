import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PlatformOrganizationDetailDto,
  PlatformPlanPerformanceDto,
} from "@/features/platform-admin/platform-admin-contracts";

import {
  CreateOrganizationAction,
  MemberActions,
  OrganizationActions,
} from "./organization-actions";

const plans: PlatformPlanPerformanceDto[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "pro",
    name: "专业版",
    tier: "pro",
    updatedAt: "2026-07-26T08:00:00.000Z",
    included: {
      activeStreamers: 10,
      seats: 5,
      ocr: 1000,
      ai: 500,
      storageMb: 10240,
      exports: 100,
    },
    features: { exports: true },
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    activeSubscriptionCount: 3,
    payingOrganizationCount: 3,
    netRevenueCents: 89700,
    standardCostCents: 12000,
    contributionMarginCents: 77700,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "business",
    name: "企业版",
    tier: "business",
    updatedAt: "2026-07-26T08:00:00.000Z",
    included: {
      activeStreamers: 30,
      seats: 15,
      ocr: 5000,
      ai: 2500,
      storageMb: 51200,
      exports: 500,
    },
    features: { exports: true },
    monthlyPriceCents: 59900,
    annualPriceCents: 599000,
    activeSubscriptionCount: 1,
    payingOrganizationCount: 1,
    netRevenueCents: 59900,
    standardCostCents: 18000,
    contributionMarginCents: 41900,
  },
];

const organization: PlatformOrganizationDetailDto = {
  id: "org-a",
  name: "安澜传媒",
  code: "anlan",
  lifecycleStatus: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-07-26T08:00:00.000Z",
  memberCount: 1,
  primaryAccount: {
    status: "confirmed",
    userId: "owner-a",
    email: "owner@anlan.cn",
    name: "安澜负责人",
    assignmentSource: "signup",
    confirmedAt: "2026-01-01T00:00:00.000Z",
  },
  subscription: {
    id: "sub-a",
    status: "active",
    billingCycle: "monthly",
    currentPeriodStart: "2026-07-01",
    currentPeriodEnd: "2026-08-01",
    updatedAt: "2026-07-26T08:00:00.000Z",
    plan: { id: plans[0].id, code: "pro", name: "专业版" },
  },
  metrics: {
    netRevenueCents: 29900,
    costCents: 12000,
    contributionMarginCents: 17900,
  },
  members: [],
  recentOrders: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CreateOrganizationAction", () => {
  it("collects organization data and closes after a successful creation", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: { organizationId: "org-new" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CreateOrganizationAction
        plans={plans}
        period={{ start: "2026-07-01", end: "2026-07-31" }}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建组织" }));

    expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    expect(screen.getByLabelText("组织编码")).toBeInTheDocument();
    expect(screen.getByLabelText("主账号姓名")).toBeInTheDocument();
    expect(screen.getByLabelText("主账号邮箱")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(screen.getByLabelText("初始密码")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("套餐")).toBeInTheDocument();
    expect(screen.getByLabelText("计费周期")).toBeInTheDocument();
    expect(screen.getByLabelText("生效日期")).toBeInTheDocument();
    expect(screen.getByLabelText("到期日期")).toBeInTheDocument();
    expect(screen.getByLabelText("记录首笔线下付款")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("记录首笔线下付款"));
    expect(screen.getByLabelText("实收金额（元）")).toBeInTheDocument();
    expect(screen.getByLabelText("付款流水号")).toBeInTheDocument();
    expect(screen.getByLabelText("操作原因")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("记录首笔线下付款"));
    fireEvent.change(screen.getByLabelText("组织名称"), {
      target: { value: "测试组织" },
    });
    fireEvent.change(screen.getByLabelText("组织编码"), {
      target: { value: "test-org" },
    });
    fireEvent.change(screen.getByLabelText("主账号姓名"), {
      target: { value: "测试主账号" },
    });
    fireEvent.change(screen.getByLabelText("主账号邮箱"), {
      target: { value: "owner@example.test" },
    });
    fireEvent.change(screen.getByLabelText("初始密码"), {
      target: { value: "OneTime#2026" },
    });
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "创建测试组织" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建组织" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建组织" })).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OrganizationActions", () => {
  it("preserves generated-subaccount form values and idempotency key across a 409 retry", async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: "CONFLICT", message: "组织数据已变化" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            member: { id: "member-new" },
            credentials: {
              account: "sub_40931",
              password: "OneTime#2026",
              requiresActivation: true,
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OrganizationActions
        organization={organization}
        plans={plans}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByText("管理操作"));
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    expect(screen.getByLabelText("邀请邮箱")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    fireEvent.change(screen.getByLabelText("创建方式"), {
      target: { value: "subaccount" },
    });
    expect(screen.getByLabelText("临时密码（留空自动生成）")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    fireEvent.change(screen.getByLabelText("账号名称"), {
      target: { value: "临时运营" },
    });
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "新增活动运营人员" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    await screen.findByText("组织数据已变化");
    expect(screen.getByLabelText("账号名称")).toHaveValue("临时运营");

    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByText("sub_40931")).toBeInTheDocument();
    expect(screen.getByText("OneTime#2026")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("requires a reason and previews plan impact before applying", async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            preview: {
              currentPlan: "专业版",
              targetPlan: "企业版",
              effectiveAt: "2026-07-26",
              currentPeriodEnd: "2026-08-01",
              nextPeriodEnd: "2026-08-01",
              currentPriceCents: 29900,
              targetPriceCents: 59900,
              includedQuantityChanges: { seats: { from: 5, to: 15 } },
            },
            applied: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { preview: {}, applied: { id: "sub-a" } },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OrganizationActions
        organization={organization}
        plans={plans}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByText("管理操作"));
    fireEvent.click(screen.getByRole("button", { name: "调整套餐" }));
    fireEvent.change(screen.getByLabelText("目标套餐"), {
      target: { value: plans[1].id },
    });
    expect(screen.getByRole("button", { name: "预览变更" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("调整原因"), {
      target: { value: "客户确认升级" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览变更" }));

    await waitFor(() => {
      expect(screen.getByText("专业版 → 企业版")).toBeInTheDocument();
    });
    expect(screen.getByText("¥299 → ¥599")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).mode).toBe(
      "preview",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).mode).toBe(
      "apply",
    );
  });
});

describe("MemberActions", () => {
  it("submits a governed account status change with the member version", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { id: "member-ops", status: "suspended" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    const member = {
      membershipId: "member-ops",
      organizationId: "org-a",
      organizationName: "安澜传媒",
      userId: "user-ops",
      email: "ops@anlan.cn",
      name: "运营一号",
      role: "operator_business",
      status: "active",
      joinedAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-26T08:00:00.000Z",
      isPrimaryAccount: false,
    };

    render(
      <MemberActions
        organizationId="org-a"
        member={member}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "管理账号" }));
    fireEvent.change(screen.getByLabelText("账号操作"), {
      target: { value: "suspend" },
    });
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "账号已不再使用" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认操作" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      status: "suspended",
      expectedUpdatedAt: member.updatedAt,
      reason: "账号已不再使用",
    });
  });
});
