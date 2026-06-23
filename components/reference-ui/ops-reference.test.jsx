import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

const taskProjectCards = [
  {
    id: "project-live",
    code: "PL-001",
    name: "Fixture Project",
    vendor: "Fixture Vendor",
    product: "rpg campaign",
    status: "active",
    pricing: "CPT",
    leadOps: "Ops",
    bizOwner: "Biz",
    start: "2026-05-20",
    end: "2026-06-10",
    streamers: { active: 2, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 100,
      doneHours: 40,
      audience: 1000,
      reportedPending: 0,
      anomalies: 0,
      receivable: 12000,
      payable: 7000,
      gross: 5000,
      margin: 41.7,
    },
    risk: "low",
  },
];

const taskStreamerCards = [
  {
    id: "streamer-one",
    alias: "Streamer One",
    real: "Streamer One",
    gender: "",
    source: "",
    supplier: "",
    games: ["rpg"],
    platforms: ["douyin"],
    style: "story",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 90,
      projectFinish: 95,
      roi: 1.2,
      grossContrib: 1000,
    },
    matchScore: 90,
    defaultRule: "CPT",
    completedProjects: 3,
    projects: [
      {
        id: "project-live",
        code: "PL-001",
        name: "Fixture Project",
        status: "joined",
        settlementHours: 0,
        grossContrib: 0,
      },
    ],
  },
  {
    id: "streamer-two",
    alias: "Streamer Two",
    real: "Streamer Two",
    gender: "",
    source: "",
    supplier: "",
    games: ["rpg"],
    platforms: ["douyin"],
    style: "story",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 88,
      projectFinish: 91,
      roi: 1.1,
      grossContrib: 900,
    },
    matchScore: 88,
    defaultRule: "CPT",
    completedProjects: 2,
    projects: [
      {
        id: "project-live",
        code: "PL-001",
        name: "Fixture Project",
        status: "joined",
        settlementHours: 0,
        grossContrib: 0,
      },
    ],
  },
];

const projectManagementCards = [
  {
    id: "project-alpha",
    code: "PA-001",
    name: "Alpha Launch",
    vendor: "Vendor A",
    product: "RPG",
    status: "active",
    pricing: "CPT",
    leadOps: "Ops A",
    bizOwner: "Biz A",
    start: "2026-06-01",
    end: "2026-06-30",
    streamers: { active: 2, candidate: 1, pendingReview: 1 },
    metrics: {
      plannedHours: 120,
      doneHours: 80,
      audience: 180000,
      reportedPending: 1,
      anomalies: 0,
      receivable: 24000,
      payable: 15000,
      gross: 9000,
      margin: 37.5,
    },
    risk: "low",
  },
  {
    id: "project-beta",
    code: "PB-002",
    name: "Beta Growth",
    vendor: "Vendor B",
    product: "Card",
    status: "recruiting",
    pricing: "CPM",
    leadOps: "Ops B",
    bizOwner: "Biz B",
    start: "",
    end: "",
    streamers: { active: 0, candidate: 3, pendingReview: 0 },
    metrics: {
      plannedHours: 60,
      doneHours: 0,
      audience: 0,
      reportedPending: 0,
      anomalies: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
      margin: 0,
    },
    risk: "medium",
  },
];

describe("OpsReferenceApp role dashboard contract", () => {
  afterEach(() => {
    vi.doUnmock("react");
    vi.resetModules();
  });

  it("publishes dashboardHome into the live data context boundary", async () => {
    const providerValues = [];
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal();
      const actualReact = actual.default ?? actual;
      const createContext = (defaultValue) => {
        const context = actualReact.createContext(defaultValue);
        const isOpsLiveDataContext =
          defaultValue &&
          Object.prototype.hasOwnProperty.call(defaultValue, "projects") &&
          Object.prototype.hasOwnProperty.call(defaultValue, "actions");

        if (isOpsLiveDataContext) {
          const Provider = context.Provider;
          context.Provider = function OpsLiveDataProviderCapture(props) {
            providerValues.push(props.value);
            return actualReact.createElement(Provider, props);
          };
        }

        return context;
      };

      return {
        ...actual,
        createContext,
        default: { ...actualReact, createContext },
      };
    });
    const { default: InstrumentedOpsReferenceApp } =
      await import("./ops-reference");
    const dashboardHome = {
      profile: {
        role: "ops_manager",
        title: "项目推进看板",
        subtitle: "关注招募、录屏、排班、报数和异常卡点",
        scopeLabel: "授权项目",
      },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      generatedAt: "2026-06-16T09:30:00.000Z",
    };

    render(
      <InstrumentedOpsReferenceApp
        initialRoute="warroom"
        dashboardHome={dashboardHome}
      />,
    );

    expect(providerValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ dashboardHome })]),
    );
  });

  it("renders owner role dashboard cards on the warroom route", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{ id: "owner-1", name: "Owner", role: "owner" }}
        dashboardHome={{
          profile: {
            role: "owner",
            title: "经营总览看板",
            subtitle: "关注收入、毛利、履约和高风险动作",
            scopeLabel: "全组织",
          },
          kpis: [
            {
              key: "activeProjects",
              label: "进行中项目",
              value: 3,
              unit: "个",
            },
            {
              key: "grossMarginRate",
              label: "预估毛利率",
              value: 31.2,
              unit: "%",
            },
          ],
          queue: [
            {
              key: "project:1",
              title: "Alpha",
              subtitle: "active · Alice",
              tone: "neutral",
              target: { route: "project", id: "project-1" },
            },
          ],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("经营总览看板")).toBeInTheDocument();
    expect(screen.getByText("进行中项目")).toBeInTheDocument();
    expect(screen.getByText("预估毛利率")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("renders finance dashboard without owner margin cards", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{ id: "finance-1", name: "Finance", role: "finance" }}
        dashboardHome={{
          profile: {
            role: "finance",
            title: "结算安全看板",
            subtitle: "关注可结算池、弱证据、人工承载和批次状态",
            scopeLabel: "财务授权范围",
          },
          kpis: [
            {
              key: "settlementPoolAmount",
              label: "可结算池金额",
              value: 8000,
              unit: "元",
            },
            {
              key: "weakEvidenceAmount",
              label: "弱证据金额",
              value: 1200,
              unit: "元",
            },
          ],
          queue: [],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("结算安全看板")).toBeInTheDocument();
    expect(screen.getByText("可结算池金额")).toBeInTheDocument();
    expect(screen.queryByText("预估毛利率")).not.toBeInTheDocument();
  });

  it("does not render executive finance labels for operator dashboard", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{
          id: "operator-1",
          name: "Operator",
          role: "operator_business",
        }}
        dashboardHome={{
          profile: {
            role: "operator_business",
            title: "我的今日待办",
            subtitle: "关注自己负责项目的任务、报数和主播提醒",
            scopeLabel: "我的项目",
          },
          kpis: [
            {
              key: "myTodayTasks",
              label: "我的今日任务",
              value: 4,
              unit: "项",
            },
            {
              key: "pendingReports",
              label: "待审核报数",
              value: 2,
              unit: "条",
            },
          ],
          queue: [],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("我的今日待办")).toBeInTheDocument();
    expect(screen.getByText("我的今日任务")).toBeInTheDocument();
    expect(screen.getByText("待审核报数")).toBeInTheDocument();
    expect(screen.queryByText("本月厂家应收")).not.toBeInTheDocument();
    expect(screen.queryByText("预估毛利")).not.toBeInTheDocument();
  });

  it("renders dashboard empty state on the warroom route", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        dashboardHome={{
          profile: {
            role: "ops_manager",
            title: "项目推进看板",
            subtitle: "关注招募、录屏、排班、报数和异常卡点",
            scopeLabel: "授权项目",
          },
          kpis: [],
          queue: [],
          risks: [],
          drilldowns: [],
          emptyState: {
            title: "暂无授权项目",
            hint: "当你获得项目授权后，系统会在这里展示优先事项。",
          },
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("暂无授权项目")).toBeInTheDocument();
    expect(
      screen.getByText("当你获得项目授权后，系统会在这里展示优先事项。"),
    ).toBeInTheDocument();
  });

  it("renders dashboard target badges with Chinese route labels", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        dashboardHome={{
          profile: {
            role: "ops_manager",
            title: "项目推进看板",
            subtitle: "关注招募、录屏、排班、报数和异常卡点",
            scopeLabel: "授权项目",
          },
          kpis: [],
          queue: [
            {
              key: "project:1",
              title: "项目卡点",
              target: { route: "project", id: "project-1" },
            },
            {
              key: "task:1",
              title: "任务卡点",
              target: { route: "tasks", id: "task-1" },
            },
          ],
          risks: [
            {
              key: "report:1",
              title: "报数卡点",
              target: { route: "reports", id: "report-1" },
            },
            {
              key: "settle:1",
              title: "结算卡点",
              target: { route: "settle", id: "batch-1" },
            },
          ],
          drilldowns: [
            {
              key: "audit:1",
              title: "审计卡点",
              target: { route: "audit", id: "audit-1" },
            },
            {
              key: "notification:1",
              title: "通知卡点",
              target: { route: "notifications", id: "notice-1" },
            },
          ],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    expect(
      within(screen.getByRole("button", { name: /项目卡点/ })).getByText(
        "项目",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /任务卡点/ })).getByText(
        "任务",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /报数卡点/ })).getByText(
        "报数",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /结算卡点/ })).getByText(
        "结算",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /审计卡点/ })).getByText(
        "审计",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /通知卡点/ })).getByText(
        "通知",
      ),
    ).toBeInTheDocument();
  });

  it("keeps project dashboard target navigation on the project detail route", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
        streamerCards={[]}
        applicationQueue={[]}
        dashboardHome={{
          profile: {
            role: "owner",
            title: "经营总览看板",
            subtitle: "关注收入、毛利、履约和高风险动作",
            scopeLabel: "全组织",
          },
          kpis: [],
          queue: [
            {
              key: "project:live",
              title: "项目卡点",
              subtitle: "active · Ops",
              tone: "neutral",
              target: { route: "project", id: "project-live" },
            },
          ],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    const projectRow = screen.getByRole("button", { name: /项目卡点/ });
    fireEvent.click(projectRow);

    expect(
      screen.getByRole("heading", { name: "Fixture Project" }),
    ).toBeInTheDocument();
  });

  it("preserves non-project dashboard target ids after navigation", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={[]}
        streamerCards={[]}
        applicationQueue={[]}
        liveTasks={[]}
        dashboardHome={{
          profile: {
            role: "ops_manager",
            title: "项目推进看板",
            subtitle: "关注招募、录屏、排班、报数和异常卡点",
            scopeLabel: "授权项目",
          },
          kpis: [],
          queue: [
            {
              key: "task:1",
              title: "任务卡点",
              subtitle: "pending_review · Streamer One",
              tone: "amber",
              target: { route: "tasks", id: "task-1" },
            },
          ],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-16T09:30:00.000Z",
        }}
      />,
    );

    const taskRow = screen.getByRole("button", { name: /任务卡点/ });
    fireEvent.click(taskRow);

    expect(screen.getByText("已定位：任务 task-1")).toBeInTheDocument();
  });

  it("uses the legacy war room fallback when dashboardHome is absent", () => {
    render(<OpsReferenceApp initialRoute="warroom" />);

    expect(screen.getByText("智能项目作战台")).toBeInTheDocument();
    expect(screen.queryByText("角色看板")).not.toBeInTheDocument();
  });
});

describe("OpsReferenceApp project smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens organization feature settings from the sidebar and syncs the switcher display", () => {
    render(<OpsReferenceApp initialRoute="warroom" />);

    fireEvent.click(screen.getByRole("button", { name: /未配置组织/ }));

    expect(
      screen.getByRole("dialog", { name: "组织功能设置" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("组织名称"), {
      target: { value: "未来经营组" },
    });
    fireEvent.change(screen.getByLabelText("成员规模"), {
      target: { value: "48" },
    });
    fireEvent.click(screen.getByLabelText("厂家门户"));
    fireEvent.click(screen.getByRole("button", { name: "保存功能设置" }));

    const orgSwitcher = screen.getByText("未来经营组").closest("button");
    expect(orgSwitcher).toHaveTextContent("当前组织 · 配额 48");
    expect(orgSwitcher).toHaveTextContent("已启用 4 项功能");
  }, 15000);

  it("uses organization logo settings in the sidebar brand mark", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        organizationSettings={{ name: "未来经营组", logoText: "未" }}
      />,
    );

    expect(screen.getByLabelText("组织 LOGO")).toHaveTextContent("未");
    expect(screen.queryByText("JY")).not.toBeInTheDocument();
  });

  it("updates the sidebar brand logo from organization settings", () => {
    render(<OpsReferenceApp initialRoute="warroom" />);

    fireEvent.click(screen.getByRole("button", { name: /未配置组织/ }));
    fireEvent.change(screen.getByLabelText("LOGO 字标"), {
      target: { value: "未" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存功能设置" }));

    expect(screen.getByLabelText("组织 LOGO")).toHaveTextContent("未");
  });

  it("keeps the organization switcher readable with a long organization name", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        organizationMembers={[]}
        organizationSettings={{ name: "星耀传媒测试机构" }}
      />,
    );

    const orgSwitcher = screen.getByText("星耀传媒测试机构").closest("button");
    expect(orgSwitcher).toHaveStyle({
      alignItems: "center",
      minWidth: "0",
    });

    const mark = orgSwitcher.querySelector("[data-org-switcher-mark='true']");
    const content = orgSwitcher.querySelector(
      "[data-org-switcher-content='true']",
    );
    const chevron = orgSwitcher.querySelector(
      "[data-org-switcher-chevron='true']",
    );

    expect(mark).toHaveStyle({ flexShrink: "0" });
    expect(content).toHaveStyle({ minWidth: "0", rowGap: "2px" });
    expect(screen.getByText("星耀传媒测试机构")).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    expect(chevron).toHaveStyle({ flexShrink: "0" });
  });

  it("renders the authenticated staff user in the sidebar", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }}
      />,
    );

    expect(screen.getByText("Alice Ops")).toBeInTheDocument();
    expect(screen.getByText("运营负责人 · Demo Org")).toBeInTheDocument();
    expect(screen.queryByText("未登录用户")).not.toBeInTheDocument();
  });

  it("opens common account options from the sidebar identity block", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Alice Ops/ }));

    expect(screen.getByRole("menu", { name: "账号菜单" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "个人资料" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "账号安全" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "组织设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "退出登录" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "组织设置" }));
    expect(
      screen.getByRole("dialog", { name: "组织功能设置" }),
    ).toBeInTheDocument();
  });

  it("opens the profile panel from the account menu without runtime errors", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        currentUser={{
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Alice Ops/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "个人资料" }));

    expect(
      screen.getByRole("dialog", { name: "个人资料" }),
    ).toBeInTheDocument();
    expect(screen.getByText("运营负责人")).toBeInTheDocument();
    expect(screen.getByText("Demo Org")).toBeInTheDocument();
  });

  it("does not show sidebar or notification badges when live queues are empty", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[]}
        liveTasks={[]}
        liveReports={[]}
        notificationItems={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /排班与任务/ }),
    ).not.toHaveTextContent("3");
    expect(
      screen.getByRole("button", { name: /报数审核/ }),
    ).not.toHaveTextContent("7");
    expect(screen.getByLabelText("通知")).not.toHaveTextContent(/\d/);
  });

  it("shows sidebar and notification badges from live queue data", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[]}
        liveTasks={[
          { id: "task-live", status: "live" },
          { id: "task-report", status: "pending_report" },
          { id: "task-done", status: "completed" },
        ]}
        liveReports={[
          { id: "report-review", status: "pending_review" },
          { id: "report-supply", status: "need_supply" },
          { id: "report-approved", status: "approved" },
        ]}
        notificationItems={[
          { id: "notice-unread", status: "unread" },
          { id: "notice-read", status: "read" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /排班与任务/ }),
    ).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /报数审核/ })).toHaveTextContent(
      "2",
    );
    expect(screen.getByLabelText("通知，1 条未读")).toHaveTextContent("1");
  });

  it("refreshes live tasks immediately when entering the tasks route after a page reload", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "task-after-page-reload",
                title: "Reload Project · Streamer One",
                status: "pending_report",
                taskType: "project",
                projectId: "project-live",
                projectName: "Fixture Project",
                streamerId: "streamer-one",
                streamerName: "Streamer One",
                plannedStartAt: null,
                plannedEndAt: null,
                plannedDuration: null,
                systemDuration: 0,
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /排班与任务/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/live-tasks", undefined),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /排班与任务/ }),
      ).toHaveTextContent("1"),
    );
  });

  it("renders backend project cards when project data is provided", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[
          {
            id: "p-db-1",
            code: "PDB-001",
            name: "数据库项目一号",
            vendor: "未填写",
            product: "数据库项目一号",
            status: "draft",
            pricing: "CPT",
            leadOps: "未分配",
            streamers: { active: 0, candidate: 0, pendingReview: 0 },
            collaborationRole: "partner",
            collaborationId: "agreement-1",
            collaborationAgreementId: "agreement-1",
            metrics: {
              plannedHours: 0,
              doneHours: 0,
              audience: 0,
              reportedPending: 0,
              anomalies: 0,
              receivable: 0,
              payable: 0,
              gross: 0,
              margin: 0,
            },
            risk: "low",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("数据库项目一号").length).toBeGreaterThan(0);
    expect(screen.getByText("PDB-001")).toBeInTheDocument();
    expect(screen.queryByText(/p-db-1/)).not.toBeInTheDocument();
    expect(screen.getAllByText("草稿").length).toBeGreaterThan(0);
  });

  it("keeps internal project ids out of project detail metadata", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[
          {
            id: "5245f59a-1502-460d-a77f-5e8e0b770d2a",
            code: "P-DETAIL",
            name: "详情项目",
            vendor: "厂商",
            product: "产品",
            status: "recruiting",
            pricing: "CPT",
            leadOps: "Ops",
            bizOwner: "Biz",
            start: "2026-06-01",
            end: "2026-06-30",
            streamers: { active: 0, candidate: 0, pendingReview: 0 },
            collaborationRole: "partner",
            collaborationId: "agreement-1",
            collaborationAgreementId: "agreement-1",
            metrics: {
              plannedHours: 0,
              doneHours: 0,
              audience: 0,
              reportedPending: 0,
              anomalies: 0,
              receivable: 0,
              payable: 0,
              gross: 0,
              margin: 0,
            },
            risk: "low",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("详情项目"));

    expect(screen.getAllByText("P-DETAIL").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/5245f59a-1502-460d-a77f-5e8e0b770d2a/),
    ).not.toBeInTheDocument();
  });

  it("shows project schedule task details from shared task data", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
        liveTasks={[
          {
            id: "task-detail-one",
            name: "Project Live Task",
            status: "pending_live",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-one",
            streamerName: "Streamer One",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            type: "project",
          },
          {
            id: "task-detail-other",
            name: "Other Project Task",
            status: "pending_live",
            project: "other-project",
            projectId: "other-project",
            projectName: "Other Project",
            streamerId: "streamer-two",
            streamerName: "Streamer Two",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            type: "project",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Fixture Project"));

    // \u8be6\u60c5\u9875\u5df2\u5355\u9875\u5316\uff1a\u6392\u73ed & \u4efb\u52a1\u533a\u5757\u59cb\u7ec8\u6e32\u67d3\uff0c\u65e0\u9700\u5207\u6362\u9875\u7b7e\u3002
    expect(screen.getAllByText("Project Live Task").length).toBeGreaterThan(0);
    expect(screen.getByText("task-detail-one")).toBeInTheDocument();
    expect(screen.queryByText("Other Project Task")).not.toBeInTheDocument();
  });

  it("masks uuid-like streamer identifiers in project execution rhythm", () => {
    const leakedStreamerId = "8939ae87-f057-4844-8034-98238cebcbf5";
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={taskProjectCards}
        streamerCards={[]}
        applicationQueue={[]}
        liveTasks={[
          {
            id: "task-rhythm-one",
            name: "Rhythm Task",
            status: "pending_live",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: leakedStreamerId,
            streamerName: leakedStreamerId,
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            type: "project",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Fixture Project"));

    expect(screen.getAllByText("未配置主播").length).toBeGreaterThan(0);
    expect(screen.queryByText(leakedStreamerId)).not.toBeInTheDocument();
  });

  it("masks uuid-like identifiers in operational views", () => {
    const uuids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ];
    const expectNoUuidText = () => {
      uuids.forEach((uuid) => {
        expect(screen.queryByText(new RegExp(uuid))).not.toBeInTheDocument();
      });
    };

    const reportsView = render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: uuids[0],
            taskId: uuids[1],
            date: "2026-06-02",
            streamer: "主播 A",
            project: "项目 A",
            duration: 2,
            audience: 900,
            status: "pending_review",
            screens: 1,
            source: "OCR",
          },
        ]}
      />,
    );
    expectNoUuidText();
    reportsView.unmount();

    const auditView = render(
      <OpsReferenceApp
        initialRoute="audit"
        auditEntries={[
          {
            id: uuids[2],
            objectId: uuids[3],
            projectId: uuids[4],
            createdAt: "2026-06-02T08:00:00.000Z",
            actorName: "审计员",
            actorRole: "owner",
            module: "project",
            action: "update",
            objectType: "project",
            objectName: "项目 A",
            result: "success",
            changedFields: ["owner"],
          },
        ]}
      />,
    );
    expectNoUuidText();
    auditView.unmount();

    const notificationView = render(
      <OpsReferenceApp
        initialRoute="notifications"
        notificationItems={[
          {
            id: uuids[5],
            objectId: uuids[6],
            objectType: "project",
            type: "task",
            status: "unread",
            createdAt: "2026-06-02T08:00:00.000Z",
            title: "待处理提醒",
          },
        ]}
      />,
    );
    expectNoUuidText();
    notificationView.unmount();

    render(
      <OpsReferenceApp
        initialRoute="org"
        organizationSettings={{
          id: uuids[7],
          name: "星耀传媒测试机构",
        }}
      />,
    );
    expectNoUuidText();
  });

  it("opens a visible draft form when creating a project", () => {
    vi.stubGlobal("prompt", undefined);

    render(<OpsReferenceApp initialRoute="projects" projectCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByLabelText("项目名称")).toBeInTheDocument();
    expect(screen.getByLabelText("项目编号")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "创建草稿" }),
    ).toBeInTheDocument();
  });

  it("creates a project draft through the backend project API", async () => {
    const refreshedProject = {
      id: "project-created",
      code: "P-NEW",
      name: "新建草稿项目",
      vendor: "未填写",
      product: "新建草稿项目",
      status: "draft",
      pricing: "CPT",
      leadOps: "未分配",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    };
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/projects" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ project: { id: "project-created" } }),
        };
      }

      return {
        ok: true,
        json: async () => ({ projects: [refreshedProject] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="projects" projectCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "新建草稿项目" },
    });
    fireEvent.change(screen.getByLabelText("项目编号"), {
      target: { value: "P-NEW" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "新建草稿项目",
      code: "P-NEW",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/projects", undefined);
    expect((await screen.findAllByText("新建草稿项目")).length).toBeGreaterThan(
      0,
    );
  });

  it("submits an external collaboration application from the new project flow", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const requestUrl = String(url);
      if (
        requestUrl === "/api/collaboration-projects/join" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            application: { id: "application-1", status: "submitted" },
            project: {
              id: "project-1",
              name: "Owner project",
              code: "COLLAB",
              ownerOrganizationName: "Owner Org",
              collaborationSummary: "Partner MCNs can contribute.",
            },
            pendingOwnerReview: true,
          }),
        };
      }
      if (requestUrl === "/api/collaboration-projects") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                agreement: {
                  id: "agreement-1",
                  status: "active",
                  revenueShareBps: 0,
                  settlementBasis: "project_revenue",
                },
                project: {
                  id: "project-1",
                  name: "Owner project",
                  code: "COLLAB",
                  ownerOrganizationName: "Owner Org",
                  collaborationSummary: "Partner MCNs can contribute.",
                },
              },
            ],
          }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${requestUrl}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[]}
        collaborationProjectCards={[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "\u65b0\u5efa\u9879\u76ee" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "\u5916\u90e8\u5408\u4f5c" }),
    );
    fireEvent.change(screen.getByLabelText("\u9080\u8bf7\u94fe\u63a5"), {
      target: {
        value: "http://localhost:3000/share/project-collaboration/raw-token",
      },
    });
    fireEvent.click(screen.getByText("\u63d0\u4ea4\u7533\u8bf7"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/collaboration-projects/join",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const joinCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/collaboration-projects/join",
    );
    expect(JSON.parse(joinCall[1].body)).toEqual({
      inviteLink: "http://localhost:3000/share/project-collaboration/raw-token",
      requestedRevenueShareBps: 0,
      applicantNote: "",
    });
    expect(
      await screen.findByText(
        "\u534f\u4f5c\u7533\u8bf7\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u9879\u76ee\u65b9\u5ba1\u6838",
      ),
    ).toBeInTheDocument();
  });

  it("invites a streamer from the project roster tab", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ application: { id: "application-invite" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="project"
        projectCards={[
          {
            id: "project-detail",
            code: "P-DETAIL",
            name: "详情项目",
            vendor: "厂商",
            product: "产品",
            status: "recruiting",
            pricing: "CPT",
            leadOps: "Ops",
            bizOwner: "Biz",
            start: "2026-06-01",
            end: "2026-06-30",
            streamers: { active: 0, candidate: 0, pendingReview: 0 },
            collaborationRole: "partner",
            collaborationId: "agreement-1",
            collaborationAgreementId: "agreement-1",
            metrics: {
              plannedHours: 0,
              doneHours: 0,
              audience: 0,
              reportedPending: 0,
              anomalies: 0,
              receivable: 0,
              payable: 0,
              gross: 0,
              margin: 0,
            },
            risk: "low",
          },
        ]}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("详情项目"));
    fireEvent.click(screen.getByRole("button", { name: "邀请主播" }));
    fireEvent.change(screen.getByLabelText("选择主播"), {
      target: { value: "streamer-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认邀请" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-detail/invitations",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streamerId: "streamer-one",
            collaborationId: "agreement-1",
          }),
        }),
      ),
    );
    expect(await screen.findByText("已邀请 Streamer One")).toBeInTheDocument();
    expect(
      await screen.findByText("streamer-one · Streamer One"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("邀约中").length).toBeGreaterThan(0);
  });
  it("keeps an invited streamer in the roster after leaving project detail", async () => {
    const projectCard = {
      id: "project-detail",
      code: "P-DETAIL",
      name: "详情项目",
      vendor: "厂商",
      product: "产品",
      status: "recruiting",
      pricing: "CPT",
      leadOps: "Ops",
      bizOwner: "Biz",
      start: "2026-06-01",
      end: "2026-06-30",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    };
    const invitedApplications = [
      {
        id: "application-invite",
        projectId: "project-detail",
        streamerId: "streamer-one",
        status: "invited",
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({ applications: invitedApplications }),
        };
      }

      return {
        ok: true,
        json: async () => ({ application: invitedApplications[0] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="project"
        projectCards={[projectCard]}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("详情项目"));
    fireEvent.click(screen.getByRole("button", { name: "邀请主播" }));
    fireEvent.change(screen.getByLabelText("选择主播"), {
      target: { value: "streamer-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认邀请" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/applications",
      undefined,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    fireEvent.click(screen.getByText("详情项目"));

    expect(
      await screen.findByText("streamer-one · Streamer One"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("邀约中").length).toBeGreaterThan(0);
  });

  it("loads streamer options in project roster without visiting the streamer pool first", async () => {
    const projectCard = {
      id: "project-detail",
      code: "P-DETAIL",
      name: "详情项目",
      vendor: "厂商",
      product: "产品",
      status: "recruiting",
      pricing: "CPT",
      leadOps: "Ops",
      bizOwner: "Biz",
      start: "2026-06-01",
      end: "2026-06-30",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    };
    const serverStreamer = {
      ...taskStreamerCards[0],
      id: "server-streamer",
      alias: "后端主播",
      real: "后端主播",
      defaultRule: "CPT",
      projects: [],
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamers") {
        return {
          ok: true,
          json: async () => ({ streamers: [serverStreamer] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ application: { id: "unused" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="project"
        projectCards={[projectCard]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("详情项目"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/streamers", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请主播" }));
    expect(await screen.findByText("后端主播 · CPT")).toBeInTheDocument();
  });

  it("warns when project-detail background roster refresh fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const projectCard = {
      ...taskProjectCards[0],
      id: "project-detail",
      code: "P-DETAIL",
      name: "Fixture Project",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    render(
      <OpsReferenceApp initialRoute="projects" projectCards={[projectCard]} />,
    );

    fireEvent.click(screen.getByText("Fixture Project"));

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        "project detail background refresh failed",
        expect.any(Error),
      ),
    );

    warnSpy.mockRestore();
  });

  it("restores invited project roster rows from applications after a page refresh", async () => {
    const projectCard = {
      id: "project-detail",
      code: "P-DETAIL",
      name: "详情项目",
      vendor: "厂商",
      product: "产品",
      status: "recruiting",
      pricing: "CPT",
      leadOps: "Ops",
      bizOwner: "Biz",
      start: "2026-06-01",
      end: "2026-06-30",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({
            applications: [
              {
                id: "application-invite",
                project: {
                  id: "project-detail",
                  code: "P-DETAIL",
                  name: "详情项目",
                },
                streamer: {
                  id: "server-streamer",
                  displayName: "后端主播",
                  cooperationStatus: "active",
                  riskLevel: "low",
                },
                status: "invited",
              },
              {
                id: "application-invite-duplicate",
                project: {
                  id: "project-detail",
                  code: "P-DETAIL",
                  name: "详情项目",
                },
                streamer: {
                  id: "server-streamer",
                  displayName: "后端主播",
                  cooperationStatus: "active",
                  riskLevel: "low",
                },
                status: "joined",
              },
            ],
          }),
        };
      }

      if (String(url) === "/api/streamers") {
        return {
          ok: true,
          json: async () => ({ streamers: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp initialRoute="project" projectCards={[projectCard]} />,
    );

    fireEvent.click(screen.getByText("详情项目"));

    // 详情页单页化后，主播阵容区块始终渲染，计数以 Badge 呈现；
    // 下方对唯一主播行的断言即可验证阵容恢复为 1 人。
    expect(
      await screen.findByText("server-streamer · 后端主播"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("server-streamer · 后端主播")).toHaveLength(1);
    expect(screen.getAllByText("邀约中").length).toBeGreaterThan(0);
  });

  it("confirms a ready roster invite from project detail and refreshes joined streamer data", async () => {
    const projectCard = {
      ...taskProjectCards[0],
      id: "project-live",
      code: "PL-001",
      name: "Fixture Project",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
    };
    const pendingApplication = {
      id: "application-ready",
      project: {
        id: "project-live",
        code: "PL-001",
        name: "Fixture Project",
      },
      streamer: {
        id: "streamer-one",
        displayName: "Streamer One",
        cooperationStatus: "active",
        riskLevel: "low",
      },
      status: "recording_approved",
    };
    const joinedApplication = { ...pendingApplication, status: "joined" };
    const joinedStreamer = {
      ...taskStreamerCards[0],
      id: "streamer-one",
      alias: "Streamer One",
      projects: [
        {
          id: "project-live",
          code: "PL-001",
          name: "Fixture Project",
          status: "joined",
        },
      ],
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications/application-ready/confirm-join") {
        return {
          ok: true,
          json: async () => ({
            projectStreamer: {
              id: "project-streamer-1",
              projectId: "project-live",
              streamerId: "streamer-one",
              status: "joined",
            },
          }),
        };
      }

      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({ applications: [joinedApplication] }),
        };
      }

      if (String(url) === "/api/streamers") {
        return {
          ok: true,
          json: async () => ({ streamers: [joinedStreamer] }),
        };
      }

      if (String(url) === "/api/projects") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                ...projectCard,
                streamers: { active: 1, candidate: 0, pendingReview: 0 },
              },
            ],
          }),
        };
      }

      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="project"
        projectCards={[projectCard]}
        streamerCards={[{ ...taskStreamerCards[0], projects: [] }]}
        applicationQueue={[pendingApplication]}
      />,
    );

    fireEvent.click(screen.getByText("Fixture Project"));
    expect(await screen.findByText("待确认加入")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认加入" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/application-ready/confirm-join",
        { method: "POST" },
      ),
    );
    await waitFor(() => expect(screen.getByText("已加入")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/applications", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/streamers", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);
  });

  it("lets staff confirm an invited roster streamer from project detail", async () => {
    const projectCard = {
      ...taskProjectCards[0],
      id: "project-live",
      code: "PL-001",
      name: "Fixture Project",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
    };
    const invitedApplication = {
      id: "application-invited",
      project: {
        id: "project-live",
        code: "PL-001",
        name: "Fixture Project",
      },
      streamer: {
        id: "streamer-one",
        displayName: "Streamer One",
        cooperationStatus: "active",
        riskLevel: "low",
      },
      status: "invited",
    };
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/applications/application-invited/confirm-join"
      ) {
        return {
          ok: true,
          json: async () => ({
            projectStreamer: {
              id: "project-streamer-1",
              projectId: "project-live",
              streamerId: "streamer-one",
              status: "joined",
            },
          }),
        };
      }

      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({
            applications: [{ ...invitedApplication, status: "joined" }],
          }),
        };
      }

      return {
        ok: true,
        json: async () =>
          String(url) === "/api/streamers"
            ? { streamers: [] }
            : { projects: [projectCard] },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="project"
        projectCards={[projectCard]}
        streamerCards={[{ ...taskStreamerCards[0], projects: [] }]}
        applicationQueue={[invitedApplication]}
      />,
    );

    fireEvent.click(screen.getByText("Fixture Project"));
    expect(await screen.findByText("邀约中")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认加入" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/application-invited/confirm-join",
        { method: "POST" },
      ),
    );
  });

  it("filters project rows by search, vendor, owner, and schedule state", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={projectManagementCards}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("项目名 / 编号 / 厂商"), {
      target: { value: "Beta" },
    });
    expect(screen.getByText("Beta Growth")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Launch")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("项目名 / 编号 / 厂商"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("厂商筛选"), {
      target: { value: "Vendor A" },
    });
    expect(screen.getByText("Alpha Launch")).toBeInTheDocument();
    expect(screen.queryByText("Beta Growth")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("厂商筛选"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("负责人筛选"), {
      target: { value: "Ops B" },
    });
    expect(screen.getByText("Beta Growth")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Launch")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("负责人筛选"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("时间范围筛选"), {
      target: { value: "scheduled" },
    });
    expect(screen.getByText("Alpha Launch")).toBeInTheDocument();
    expect(screen.queryByText("Beta Growth")).not.toBeInTheDocument();
  });

  it("exports the filtered project table through the governed export API", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ export: { id: "export-projects" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={projectManagementCards}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("项目名 / 编号 / 厂商"), {
      target: { value: "Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导出项目表" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kind: "project_execution",
      rows: [
        {
          projectName: "Alpha Launch",
          status: "active",
          operatorName: "Ops A",
        },
      ],
    });
    expect(await screen.findByText(/项目表导出已生成/)).toBeInTheDocument();
  });

  it("exports a vendor delivery package from project detail", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/delivery-packages?projectId=project-alpha") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                projectId: "project-alpha",
                projectName: "Alpha Launch",
                streamerName: "Streamer Alpha",
                settlementDurationMinutes: 120,
                evidenceLevel: "green",
                screenshotCount: 2,
              },
            ],
          }),
        };
      }

      if (String(url) === "/api/exports") {
        return {
          ok: true,
          json: async () => ({ export: { id: "export-delivery" } }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[projectManagementCards[0]]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("Alpha Launch"));
    fireEvent.click(screen.getByRole("button", { name: "厂家交付包" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/delivery-packages?projectId=project-alpha",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exports",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const exportCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/exports",
    );
    expect(JSON.parse(exportCall[1].body)).toEqual({
      kind: "vendor_delivery",
      rows: [
        {
          projectId: "project-alpha",
          projectName: "Alpha Launch",
          streamerName: "Streamer Alpha",
          settlementDurationMinutes: 120,
          evidenceLevel: "green",
          screenshotCount: 2,
        },
      ],
    });
    expect(await screen.findByText(/厂家交付包已生成/)).toBeInTheDocument();
  });

  it("routes new schedule to the task module", () => {
    const { unmount } = render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[projectManagementCards[0]]}
        liveTasks={[]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("Alpha Launch"));
    fireEvent.click(screen.getByRole("button", { name: "新建排班" }));
    expect(
      screen.getByRole("heading", { name: "排班与任务" }),
    ).toBeInTheDocument();

    unmount();
  });

  it("updates project settings through the project API and refreshes detail data", async () => {
    const refreshedProject = {
      ...projectManagementCards[0],
      name: "Alpha Launch Updated",
      ownerId: "user-ops-b",
      leadOps: "Ops B",
      vendor: "Vendor Prime",
      product: "RPG Pro",
      agent: "Agency One",
      supplier: "Supplier One",
      description: "Project profile is now configurable.",
      status: "paused",
      start: "2026-06-05",
      end: "2026-06-30",
      needScreening: false,
      needStartStop: false,
      isPublicToStreamers: true,
      publicSummary: "Streamer-facing project summary",
      gameDownloadUrl: "https://download.example.com/game-a",
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/projects/project-alpha") {
        return {
          ok: true,
          json: async () => ({ project: { id: "project-alpha" } }),
        };
      }
      if (String(url) === "/api/projects") {
        return {
          ok: true,
          json: async () => ({ projects: [refreshedProject] }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${url}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        currentUser={{
          id: "user-owner",
          name: "Owner",
          role: "owner",
          dept: "Demo Org",
        }}
        organizationMembers={[
          {
            id: "member-owner",
            userId: "user-owner",
            name: "Owner",
            role: "owner",
            status: "active",
          },
          {
            id: "member-ops-a",
            userId: "user-ops-a",
            name: "Ops A",
            role: "ops_manager",
            status: "active",
          },
          {
            id: "member-ops-b",
            userId: "user-ops-b",
            name: "Ops B",
            role: "ops_manager",
            status: "active",
          },
        ]}
        projectCards={[{ ...projectManagementCards[0], ownerId: "user-ops-a" }]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );
    fireEvent.click(screen.getByText("Alpha Launch"));
    fireEvent.click(screen.getByRole("button", { name: "项目设置" }));

    expect(await screen.findByText("状态设置")).toBeInTheDocument();
    const originalShowPicker = HTMLInputElement.prototype.showPicker;
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker,
    });
    fireEvent.click(screen.getByLabelText("开始日期"));
    expect(showPicker).toHaveBeenCalledTimes(1);
    if (originalShowPicker) {
      Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
        configurable: true,
        value: originalShowPicker,
      });
    } else {
      delete HTMLInputElement.prototype.showPicker;
    }
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "Alpha Launch Updated" },
    });
    fireEvent.change(screen.getByLabelText("厂商"), {
      target: { value: "Vendor Prime" },
    });
    fireEvent.change(screen.getByLabelText("产品"), {
      target: { value: "RPG Pro" },
    });
    fireEvent.change(screen.getByLabelText("代理商"), {
      target: { value: "Agency One" },
    });
    fireEvent.change(screen.getByLabelText("供应商"), {
      target: { value: "Supplier One" },
    });
    fireEvent.change(screen.getByLabelText("项目说明"), {
      target: { value: "Project profile is now configurable." },
    });
    fireEvent.change(screen.getByLabelText("负责人"), {
      target: { value: "user-ops-b" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "项目状态" }));
    expect(
      screen.getByRole("listbox", { name: "项目状态选项" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "已暂停" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-06-05" },
    });
    fireEvent.click(screen.getByLabelText("强制录屏"));
    fireEvent.click(screen.getByLabelText("主播需点击开播/停止"));
    fireEvent.click(screen.getByLabelText("公开给组织内主播"));
    fireEvent.change(screen.getByLabelText("主播公告概括"), {
      target: { value: "Streamer-facing project summary" },
    });
    expect(screen.getByLabelText("主播公告概括").tagName).toBe("TEXTAREA");
    fireEvent.change(screen.getByLabelText("游戏下载链接"), {
      target: { value: "https://download.example.com/game-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/project-alpha");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Alpha Launch Updated",
      vendorName: "Vendor Prime",
      productName: "RPG Pro",
      agentName: "Agency One",
      supplierName: "Supplier One",
      description: "Project profile is now configurable.",
      ownerId: "user-ops-b",
      status: "paused",
      startsAt: "2026-06-05",
      endsAt: "2026-06-30",
      openSignup: true,
      allowDirectInvite: true,
      forceRecording: false,
      forceSystemTiming: false,
      isPublicToStreamers: true,
      publicSummary: "Streamer-facing project summary",
      gameDownloadUrl: "https://download.example.com/game-a",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/projects");
    expect(await screen.findByText("项目设置已更新")).toBeInTheDocument();
    expect(await screen.findByText("Alpha Launch Updated")).toBeInTheDocument();
    expect(await screen.findByText("Vendor Prime")).toBeInTheDocument();
    expect(await screen.findByText("Supplier One")).toBeInTheDocument();
    expect(
      screen.getByText("Project profile is now configurable."),
    ).toBeInTheDocument();
    expect(await screen.findByText("组织内公开")).toBeInTheDocument();
    expect(
      screen.getByText("Streamer-facing project summary"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "游戏下载已配置" }),
    ).toHaveAttribute("href", "https://download.example.com/game-a");
    expect(screen.queryByText("项目设置后台暂未接入")).not.toBeInTheDocument();
  });

  it("hides illegal project status targets from settings", () => {
    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[projectManagementCards[0]]}
      />,
    );

    fireEvent.click(screen.getByText("Alpha Launch"));
    fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
    fireEvent.click(screen.getByRole("combobox", { name: "项目状态" }));

    expect(screen.getByRole("option", { name: "进行中" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "已暂停" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "已结束" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "结算中" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "已结束" }));
    fireEvent.click(screen.getByRole("combobox", { name: "项目状态" }));
    expect(
      screen.queryByRole("option", { name: "结算中" }),
    ).not.toBeInTheDocument();
  });
  it("shows recruiting as a draft project status target in settings", () => {
    const draftProject = {
      ...projectManagementCards[0],
      id: "project-draft",
      code: "PD-001",
      name: "Draft Project",
      status: "draft",
    };

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[draftProject]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("Draft Project"));
    const settingsButton = screen
      .getAllByRole("button")
      .find((button) =>
        button.textContent?.includes("\u9879\u76ee\u8bbe\u7f6e"),
      );
    expect(settingsButton).toBeDefined();
    fireEvent.click(settingsButton);
    fireEvent.click(
      screen.getByRole("combobox", { name: "\u9879\u76ee\u72b6\u6001" }),
    );

    expect(
      screen.getByRole("option", { name: "\u8349\u7a3f" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "\u62db\u52df\u4e2d" }),
    ).toBeInTheDocument();
  });

  it("publishes draft projects through the publish action when selected in settings", async () => {
    const draftProject = {
      ...projectManagementCards[0],
      id: "project-draft",
      code: "PD-001",
      name: "Draft Project",
      status: "draft",
    };
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/projects/project-draft") {
        return {
          ok: true,
          json: async () => ({ project: draftProject }),
        };
      }
      if (requestUrl === "/api/projects/project-draft/publish") {
        return {
          ok: true,
          json: async () => ({
            project: { ...draftProject, status: "recruiting" },
          }),
        };
      }
      if (requestUrl === "/api/projects") {
        return {
          ok: true,
          json: async () => ({
            projects: [{ ...draftProject, status: "recruiting" }],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[draftProject]}
        streamerCards={[]}
        applicationQueue={[]}
        organizationMembers={[]}
      />,
    );

    fireEvent.click(screen.getByText("Draft Project"));
    const settingsButton = screen
      .getAllByRole("button")
      .find((button) =>
        button.textContent?.includes("\u9879\u76ee\u8bbe\u7f6e"),
      );
    fireEvent.click(settingsButton);
    fireEvent.click(
      screen.getByRole("combobox", { name: "\u9879\u76ee\u72b6\u6001" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "\u62db\u52df\u4e2d" }));
    fireEvent.click(
      screen.getByRole("button", { name: "\u4fdd\u5b58\u8bbe\u7f6e" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-draft/publish",
        { method: "POST" },
      ),
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/project-draft");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
      "status",
    );
  });

  it("manages external MCN collaboration from project detail", async () => {
    const collaborationProject = {
      ...projectManagementCards[0],
      isOpenToMcnCollaboration: false,
      mcnCollaborationSummary: "",
      mcnCollaborationTerms: {},
    };
    const refreshedProject = {
      ...collaborationProject,
      isOpenToMcnCollaboration: true,
      mcnCollaborationSummary:
        "Partner MCNs can contribute verified streamers.",
      mcnCollaborationTerms: { revenueShareHint: "8-12%" },
    };
    const fetchMock = vi.fn(async (url, init) => {
      const requestUrl = String(url);
      if (
        requestUrl === "/api/projects/project-alpha" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({ project: { id: "project-alpha" } }),
        };
      }
      if (requestUrl === "/api/projects") {
        return {
          ok: true,
          json: async () => ({ projects: [refreshedProject] }),
        };
      }
      if (
        requestUrl === "/api/projects/project-alpha/collaboration-shares" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            share: { id: "share-1", status: "active" },
            shareUrl:
              "http://localhost:3000/share/project-collaboration/raw-token",
          }),
        };
      }
      if (
        requestUrl ===
          "/api/projects/project-alpha/collaboration-applications" &&
        init?.method === "GET"
      ) {
        return {
          ok: true,
          json: async () => ({
            applications: [
              {
                id: "application-1",
                applicantOrganizationId: "org-partner",
                requestedRevenueShareBps: 900,
                status: "submitted",
                applicantNote: "We can bring streamers.",
              },
              {
                id: "application-2",
                applicantOrganizationId: "org-counter",
                requestedRevenueShareBps: 1200,
                status: "submitted",
                applicantNote: "Counter us.",
              },
              {
                id: "application-3",
                applicantOrganizationId: "org-reject",
                requestedRevenueShareBps: 1500,
                status: "submitted",
                applicantNote: "Reject us.",
              },
            ],
          }),
        };
      }
      if (
        requestUrl.startsWith(
          "/api/projects/project-alpha/collaboration-applications/",
        ) &&
        requestUrl.endsWith("/review") &&
        init?.method === "POST"
      ) {
        const id = requestUrl.split("/").at(-2);
        const body = JSON.parse(init.body);
        const status =
          body.action === "counter"
            ? "owner_countered"
            : body.action === "reject"
              ? "rejected"
              : "approved";
        return {
          ok: true,
          json: async () => ({
            application: { id, status },
            agreement:
              body.action === "accept"
                ? { id: "agreement-1", status: "active" }
                : null,
          }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${requestUrl}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        currentUser={{
          id: "user-owner",
          name: "Owner",
          role: "owner",
          dept: "Demo Org",
        }}
        projectCards={[collaborationProject]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("Alpha Launch"));
    // \u5916\u90e8 MCN \u534f\u4f5c is now tucked into \u9879\u76ee\u8bbe\u7f6e \u2014 open it first.
    fireEvent.click(screen.getByRole("button", { name: "\u9879\u76ee\u8bbe\u7f6e" }));
    expect(
      screen.getByText("\u5916\u90e8 MCN \u534f\u4f5c"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText("\u5f00\u653e\u5916\u90e8 MCN \u534f\u4f5c"),
    );
    fireEvent.change(screen.getByLabelText("\u534f\u4f5c\u6458\u8981"), {
      target: { value: "Partner MCNs can contribute verified streamers." },
    });
    fireEvent.change(screen.getByLabelText("\u5206\u6210\u5efa\u8bae"), {
      target: { value: "8-12%" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "\u4fdd\u5b58\u534f\u4f5c\u8bbe\u7f6e",
      }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-alpha",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const updateCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/projects/project-alpha" &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(updateCall[1].body)).toEqual({
      isOpenToMcnCollaboration: true,
      mcnCollaborationSummary:
        "Partner MCNs can contribute verified streamers.",
      mcnCollaborationTerms: { revenueShareHint: "8-12%" },
    });

    await screen.findByText("\u534f\u4f5c\u8bbe\u7f6e\u5df2\u4fdd\u5b58");
    fireEvent.click(
      screen.getByRole("button", {
        name: "\u751f\u6210\u534f\u4f5c\u94fe\u63a5",
      }),
    );
    expect(
      await screen.findByDisplayValue(
        "http://localhost:3000/share/project-collaboration/raw-token",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "\u590d\u5236\u94fe\u63a5" }),
    ).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByDisplayValue(
        "http://localhost:3000/share/project-collaboration/raw-token",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "\u5237\u65b0\u7533\u8bf7" }),
    );
    expect(
      await screen.findByText("We can bring streamers."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "\u901a\u8fc7\u7533\u8bf7" })[0],
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-alpha/collaboration-applications/application-1/review",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const reviewCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(
          "/collaboration-applications/application-1/review",
        ) && init?.method === "POST",
    );
    expect(JSON.parse(reviewCall[1].body)).toEqual({
      action: "accept",
      ownerReviewNote: "",
    });

    fireEvent.change(
      screen.getAllByLabelText("\u53cd\u62a5\u4ef7\u6bd4\u4f8b")[0],
      {
        target: { value: "8" },
      },
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "\u63d0\u4ea4\u53cd\u62a5\u4ef7",
      })[0],
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(
              "/collaboration-applications/application-2/review",
            ) && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const counterCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(
          "/collaboration-applications/application-2/review",
        ) && init?.method === "POST",
    );
    expect(JSON.parse(counterCall[1].body)).toEqual({
      action: "counter",
      ownerCounterRevenueShareBps: 800,
      ownerReviewNote: "",
    });

    fireEvent.change(screen.getAllByLabelText("\u62d2\u7edd\u539f\u56e0")[0], {
      target: { value: "\u5f53\u524d\u6863\u671f\u4e0d\u5339\u914d\u3002" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "\u786e\u8ba4\u62d2\u7edd" })[0],
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(
              "/collaboration-applications/application-3/review",
            ) && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const rejectCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(
          "/collaboration-applications/application-3/review",
        ) && init?.method === "POST",
    );
    expect(JSON.parse(rejectCall[1].body)).toEqual({
      action: "reject",
      ownerReviewNote: "",
      rejectionReason: "\u5f53\u524d\u6863\u671f\u4e0d\u5339\u914d\u3002",
    });
  });

  it("confirms owner counter offers from partner collaboration detail", async () => {
    const counterProject = {
      ...projectManagementCards[0],
      id: "project-counter",
      code: "COUNTER",
      name: "Counter Project",
      collaborationRole: "partner",
      collaborationApplicationId: "application-1",
      collaborationApplicationStatus: "owner_countered",
      requestedRevenueShareBps: 1200,
      ownerCounterRevenueShareBps: 900,
      ownerOrganizationName: "Owner Org",
      collaborationSummary: "Needs confirmation.",
    };
    const fetchMock = vi.fn(async (url, init) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
          "/api/projects/project-counter/collaboration-applications/application-1/confirm" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            application: { id: "application-1", status: "approved" },
            agreement: { id: "agreement-1", status: "active" },
          }),
        };
      }
      if (requestUrl === "/api/collaboration-projects") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                agreement: {
                  id: "agreement-1",
                  status: "active",
                  revenueShareBps: 900,
                  settlementBasis: "project_revenue",
                },
                project: {
                  id: "project-counter",
                  name: "Counter Project",
                  code: "COUNTER",
                  ownerOrganizationName: "Owner Org",
                  collaborationSummary: "Needs confirmation.",
                },
              },
            ],
            applications: [],
          }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${requestUrl}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="projects"
        projectCards={[]}
        collaborationProjectCards={[counterProject]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByText("Counter Project"));
    expect(
      screen.getByText("\u534f\u4f5c\u53cd\u62a5\u4ef7\u5f85\u786e\u8ba4"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("\u9879\u76ee\u65b9\u53cd\u62a5\u4ef7 9.00%"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "\u786e\u8ba4\u53cd\u62a5\u4ef7" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-counter/collaboration-applications/application-1/confirm",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText(
        "\u53cd\u62a5\u4ef7\u5df2\u786e\u8ba4\uff0c\u534f\u4f5c\u5df2\u751f\u6548",
      ),
    ).toBeInTheDocument();
  });
});

describe("OpsReferenceApp OCR operations smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists OCR jobs, retries, runs, and confirms without exposing raw provider data", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("/api/ocr/jobs") && init === undefined) {
        if (requestUrl === "/api/ocr/jobs?status=failed") {
          return {
            ok: true,
            json: async () => ({
              jobs: [
                {
                  id: "ocr-job-1",
                  status: "failed",
                  attempt: 2,
                  maxAttempts: 3,
                  liveReportId: "report-1",
                  errorCode: "provider_failed",
                  errorMessage: "Tencent OCR HTTP 500",
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            jobs: [
              {
                id: "ocr-job-1",
                status: "failed",
                attempt: 2,
                maxAttempts: 3,
                aiInvocationId: "invocation-1",
                liveReportId: "report-1",
                screenshotId: "screenshot-1",
                errorCode: "provider_failed",
                errorMessage: "Tencent OCR HTTP 500",
                payload: {
                  imageBase64: "secret-image",
                  imagePath: "org/report-screenshots/task-1/end.png",
                },
                rawResponse: { text: "rawResponse" },
                result: {
                  extractedDuration: 80,
                  extractedViewers: 320,
                  rawResponse: "rawResponse",
                },
                createdAt: "2026-06-05T01:00:00.000Z",
                updatedAt: "2026-06-05T01:10:00.000Z",
              },
            ],
          }),
        };
      }

      if (
        requestUrl === "/api/ocr/jobs/ocr-job-1" &&
        init?.method === "POST" &&
        JSON.parse(init.body).action === "retry"
      ) {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-1",
              status: "queued",
              attempt: 2,
              maxAttempts: 3,
              liveReportId: "report-1",
              errorCode: "provider_failed",
              errorMessage: "Tencent OCR HTTP 500",
            },
          }),
        };
      }

      if (requestUrl === "/api/ocr/jobs/run" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              {
                id: "ocr-job-1",
                status: "needs_confirmation",
                attempt: 3,
                maxAttempts: 3,
                liveReportId: "report-1",
                errorCode: "low_confidence",
                errorMessage: "low_provider_confidence",
              },
            ],
          }),
        };
      }

      if (
        requestUrl === "/api/ocr/jobs/ocr-job-1" &&
        init?.method === "POST" &&
        JSON.parse(init.body).action === "needs_review"
      ) {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-1",
              status: "needs_review",
              attempt: 2,
              maxAttempts: 3,
              liveReportId: "report-1",
              errorCode: "needs_review",
              errorMessage: "manual_review_requested",
            },
          }),
        };
      }

      if (
        requestUrl === "/api/ocr/jobs/ocr-job-1" &&
        init?.method === "POST" &&
        JSON.parse(init.body).action === "confirm"
      ) {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-1",
              status: "succeeded",
              attempt: 3,
              maxAttempts: 3,
              liveReportId: "report-1",
              reviewedBy: "user-ops",
              reviewedAt: "2026-06-05T02:30:00.000Z",
            },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${requestUrl}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="warroom" />);

    fireEvent.click(screen.getByRole("button", { name: "OCR 作业" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/ocr/jobs", undefined),
    );
    expect(await screen.findByText("ocr-job-1")).toBeInTheDocument();
    expect(await screen.findByText("screenshot-1")).toBeInTheDocument();
    expect(await screen.findByText("时长 80")).toBeInTheDocument();
    expect(await screen.findByText("场观 320")).toBeInTheDocument();
    expect(await screen.findByText("识别服务失败")).toBeInTheDocument();
    expect(await screen.findByText("2/3")).toBeInTheDocument();
    expect(
      JSON.stringify(screen.queryByText("org/report-screenshots")),
    ).not.toContain("org/report-screenshots");
    expect(
      screen.queryByText(/org\/report-screenshots/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("imagePath")).not.toBeInTheDocument();
    expect(screen.queryByText("imageBase64")).not.toBeInTheDocument();
    expect(screen.queryByText("rawResponse")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-image")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs?status=failed",
        undefined,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "手动重试" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs/ocr-job-1",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        }),
      ),
    );
    expect(
      await screen.findByText("排队中", { selector: "span" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行下一条 OCR" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs/run",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1 }),
        }),
      ),
    );
    expect(await screen.findByText("待确认")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "标记需复核" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs/ocr-job-1",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "needs_review" }),
        }),
      ),
    );
    expect((await screen.findAllByText("需复核")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("修正时长 ocr-job-1"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("修正观看人数 ocr-job-1"), {
      target: { value: "320" },
    });

    fireEvent.click(screen.getByRole("button", { name: "人工确认" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs/ocr-job-1",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
            manualResult: { duration: 80, viewers: 320 },
          }),
        }),
      ),
    );
    expect(
      await screen.findByText("成功", { selector: "span" }),
    ).toBeInTheDocument();
  });
});

describe("OpsReferenceApp streamer smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders backend streamer cards when streamer data is provided", () => {
    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "s-db-1",
            alias: "数据库主播",
            real: "鹿鸣",
            gender: "女",
            source: "签约",
            supplier: "未绑定",
            games: ["二游"],
            platforms: ["抖音"],
            style: "高能整活",
            cooperation: "active",
            risk: "medium",
            defaultRule: "CPT",
            matchScore: 80,
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("数据库主播").length).toBeGreaterThan(0);
    expect(screen.getByText("s-db-1 · 鹿鸣")).toBeInTheDocument();
    expect(screen.getAllByText("风险 medium").length).toBeGreaterThan(0);
  });

  it("refreshes streamer cards on the streamer route when server data is not preloaded", async () => {
    const fetchedStreamer = {
      id: "streamer-refreshed",
      alias: "Fetched Streamer",
      real: "Fetched Real",
      gender: "",
      source: "external",
      supplier: "",
      games: ["rpg"],
      platforms: ["douyin"],
      style: "story",
      cooperation: "active",
      risk: "low",
      metrics: {
        screenPass: 92,
        projectFinish: 88,
        roi: 1.2,
        grossContrib: 1200,
      },
      matchScore: 90,
      defaultRule: "CPT",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ streamers: [fetchedStreamer] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="streamers" />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/streamers", undefined),
    );
    expect(
      (await screen.findAllByText("Fetched Streamer")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/streamer-refreshed.*Fetched Real/),
    ).toBeInTheDocument();
  });

  it("shows an empty operating profile instead of placeholder streamer metrics", () => {
    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "streamer-empty-profile",
            alias: "Empty Profile",
            real: "No History",
            gender: "",
            source: "external",
            supplier: "",
            games: ["rpg"],
            platforms: ["douyin"],
            style: "story",
            cooperation: "not_started",
            risk: "low",
            hasPerformanceData: false,
            metrics: {
              screenPass: 0,
              projectFinish: 0,
              roi: 0,
              grossContrib: 0,
            },
            matchScore: 0,
            matchTrend: [],
            defaultRule: "CPT",
          },
        ]}
      />,
    );

    expect(screen.getByText("暂无经营画像数据")).toBeInTheDocument();
    expect(screen.queryByText("录屏通过率")).not.toBeInTheDocument();
    expect(screen.queryByText("近 6 周匹配分趋势")).not.toBeInTheDocument();
  });

  it("creates a streamer profile through the backend API and refreshes the pool", async () => {
    const refreshedStreamer = {
      id: "streamer-created",
      alias: "小鹿",
      real: "鹿鸣",
      gender: "女",
      source: "签约",
      supplier: "未绑定",
      games: ["二游", "卡牌"],
      platforms: ["抖音"],
      style: "高能整活",
      cooperation: "not_started",
      risk: "low",
      metrics: {
        screenPass: 65,
        projectFinish: 65,
        roi: 1,
        grossContrib: 0,
      },
      matchScore: 65,
      defaultRule: "CPS",
      completedProjects: 0,
    };
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({
            members: [
              {
                id: "member-streamer-sub",
                userId: "user-streamer-sub",
                email: "jy-streamer@subaccount.local",
                name: "小龙",
                role: "streamer",
                status: "active",
              },
              {
                id: "member-ops",
                userId: "user-ops",
                email: "ops@example.cn",
                name: "运营",
                role: "ops_manager",
                status: "active",
              },
            ],
            permissions: {
              canViewMembers: true,
              canCreateMembers: true,
              creatableRoles: ["streamer"],
            },
          }),
        };
      }

      if (String(url) === "/api/streamers" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ streamer: { id: "streamer-created" } }),
        };
      }

      return {
        ok: true,
        json: async () => ({ streamers: [refreshedStreamer] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="streamers" streamerCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新增主播档案" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/members",
        undefined,
      ),
    );
    expect(
      screen.queryByText("仅显示组织内角色为主播的子账号"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("绑定主播子账号"), {
      target: { value: "小龙" },
    });
    fireEvent.click(
      await screen.findByRole("option", { name: /小龙.*jy-streamer/ }),
    );
    fireEvent.change(screen.getByLabelText("主播昵称"), {
      target: { value: "小鹿" },
    });
    fireEvent.change(screen.getByLabelText("真实姓名"), {
      target: { value: "鹿鸣" },
    });
    fireEvent.change(screen.getByLabelText("来源"), {
      target: { value: "signed" },
    });
    fireEvent.change(screen.getByLabelText("擅长品类"), {
      target: { value: "二游, 卡牌" },
    });
    fireEvent.change(screen.getByLabelText("平台"), {
      target: { value: "抖音" },
    });
    fireEvent.change(screen.getByLabelText("直播风格"), {
      target: { value: "高能整活" },
    });
    fireEvent.change(screen.getByLabelText("默认结算"), {
      target: { value: "cps" },
    });
    fireEvent.change(screen.getByLabelText("CPS 分成比例"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建档案" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/streamers" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const streamerPostCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamers" && init?.method === "POST",
    );
    expect(streamerPostCall[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(streamerPostCall[1].body)).toEqual({
      displayName: "小鹿",
      realName: "鹿鸣",
      gender: "",
      sourceType: "signed",
      categories: ["二游", "卡牌"],
      platforms: ["抖音"],
      styles: ["高能整活"],
      defaultSettlementMethod: "cps",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 1500,
      userId: "user-streamer-sub",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/streamers", undefined);
    expect(
      await screen.findByText("streamer-created · 鹿鸣"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("小鹿").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CPS").length).toBeGreaterThan(0);
  });

  it("submits CPT and base salary fields from the streamer create form", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({
            members: [],
            permissions: {
              canViewMembers: true,
              canCreateMembers: true,
              creatableRoles: ["streamer"],
            },
          }),
        };
      }
      if (String(url) === "/api/streamers" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ streamer: { id: "streamer-priced" } }),
        };
      }
      return { ok: true, json: async () => ({ streamers: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="streamers" streamerCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新增主播档案" }));
    fireEvent.change(screen.getByLabelText("主播昵称"), {
      target: { value: "Priced Streamer" },
    });
    fireEvent.change(screen.getByLabelText("默认结算"), {
      target: { value: "base_salary_cpt" },
    });
    fireEvent.change(screen.getByLabelText("CPT 小时单价"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("底薪"), {
      target: { value: "6000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建档案" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/streamers" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const streamerPostCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamers" && init?.method === "POST",
    );
    expect(JSON.parse(streamerPostCall[1].body)).toEqual(
      expect.objectContaining({
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 0,
      }),
    );
  });

  it("requires selecting a matched streamer subaccount before binding", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({
            members: [
              {
                id: "member-streamer",
                userId: "user-streamer-sub",
                email: "789@789.com",
                name: "1",
                role: "streamer",
                status: "active",
              },
            ],
            permissions: {
              canViewMembers: true,
              canCreateMembers: true,
              creatableRoles: ["streamer"],
            },
          }),
        };
      }
      if (String(url) === "/api/streamers" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ streamer: { id: "streamer-should-not-save" } }),
        };
      }
      return { ok: true, json: async () => ({ streamers: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="streamers" streamerCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新增主播档案" }));
    fireEvent.change(screen.getByLabelText("主播昵称"), {
      target: { value: "阿斯顿" },
    });
    fireEvent.change(screen.getByLabelText("绑定主播子账号"), {
      target: { value: "1 · 789@789.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建档案" }));

    expect(
      await screen.findByText("请从候选列表选择主播子账号，或清空后不绑定"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/streamers" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("filters streamer rows by search and risk", () => {
    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "s-filter-low",
            alias: "小鹿",
            real: "鹿鸣",
            gender: "女",
            source: "签约",
            supplier: "未绑定",
            games: ["二游"],
            platforms: ["抖音"],
            style: "高能整活",
            cooperation: "active",
            risk: "low",
            defaultRule: "CPT",
            matchScore: 80,
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
          },
          {
            id: "s-filter-high",
            alias: "北风",
            real: "周北",
            gender: "女",
            source: "外部",
            supplier: "未绑定",
            games: ["SLG"],
            platforms: ["快手"],
            style: "稳态讲解",
            cooperation: "paused",
            risk: "high",
            defaultRule: "CPT",
            matchScore: 66,
            metrics: {
              screenPass: 66,
              projectFinish: 66,
              roi: 0.9,
              grossContrib: 0,
            },
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("主播名 / 真名 / 平台账号"), {
      target: { value: "北风" },
    });
    expect(screen.getAllByText("北风").length).toBeGreaterThan(0);
    expect(screen.queryByText("s-filter-low · 鹿鸣")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("风险筛选"), {
      target: { value: "low" },
    });
    expect(screen.getByText("暂无匹配主播")).toBeInTheDocument();
  });

  it("renders streamer performance and project contributions from backend data", () => {
    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "streamer-live-metrics",
            alias: "Live Metrics Streamer",
            real: "Metrics Real",
            gender: "未填写",
            source: "外部",
            supplier: "未绑定",
            games: ["MMO"],
            platforms: ["Video"],
            style: "Traffic Push",
            cooperation: "active",
            risk: "low",
            defaultRule: "CPT",
            matchScore: 76,
            metrics: {
              screenPass: 50,
              projectFinish: 100,
              roi: 0.9,
              grossContrib: 150,
            },
            projects: [
              {
                id: "project-live",
                code: "PL",
                name: "Live Project",
                status: "joined",
                settlementHours: 3,
                grossContrib: 150,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.90").length).toBeGreaterThan(0);
    expect(screen.getByText("¥0.2k")).toBeInTheDocument();
    expect(screen.getByText("Live Project")).toBeInTheDocument();
    expect(screen.getByText("3.0 h · ¥150.0")).toBeInTheDocument();
  });

  it("updates streamer risk and refreshes the pool", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/streamers/streamer-risk/risk" &&
        init?.method === "PATCH"
      ) {
        return { ok: true, json: async () => ({ streamer: {} }) };
      }
      return {
        ok: true,
        json: async () => ({
          streamers: [
            {
              id: "streamer-risk",
              alias: "小鹿",
              real: "鹿鸣",
              gender: "女",
              source: "签约",
              supplier: "未绑定",
              games: ["二游"],
              platforms: ["抖音"],
              style: "高能整活",
              cooperation: "active",
              risk: "high",
              defaultRule: "CPT",
              matchScore: 80,
              metrics: {
                screenPass: 80,
                projectFinish: 80,
                roi: 1.08,
                grossContrib: 0,
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "streamer-risk",
            alias: "小鹿",
            real: "鹿鸣",
            gender: "女",
            source: "签约",
            supplier: "未绑定",
            games: ["二游"],
            platforms: ["抖音"],
            style: "高能整活",
            cooperation: "active",
            risk: "low",
            defaultRule: "CPT",
            matchScore: 80,
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "设置风险" }));
    fireEvent.change(screen.getByLabelText("风险等级"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText("风险原因"), {
      target: { value: "连续两次异常报数" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新风险" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/streamers/streamer-risk/risk",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      riskLevel: "high",
      riskReason: "连续两次异常报数",
      reason: "连续两次异常报数",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/streamers", undefined);
    expect(screen.getAllByText("风险 high").length).toBeGreaterThan(0);
  });

  it("edits streamer profile from the detail panel and refreshes business loop data", async () => {
    const refreshedStreamer = {
      id: "streamer-edit",
      alias: "Updated Streamer",
      real: "Updated Real",
      gender: "female",
      source: "签约",
      supplier: "未绑定",
      games: ["RPG", "Card"],
      platforms: ["Douyin"],
      style: "Story",
      cooperation: "active",
      risk: "low",
      defaultRule: "CPS 15%",
      settlement: {
        method: "cps",
        cptHourlyRate: 0,
        baseSalary: 0,
        cpsRateBps: 1500,
        label: "CPS 15%",
      },
      metrics: {
        screenPass: 80,
        projectFinish: 80,
        roi: 1.08,
        grossContrib: 0,
      },
      matchScore: 80,
    };
    const fetchMock = vi.fn(async (url, init) => {
      const requestUrl = String(url);
      if (
        requestUrl === "/api/streamers/streamer-edit" &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({ streamer: { id: "streamer-edit" } }),
        };
      }
      if (requestUrl === "/api/streamers") {
        return {
          ok: true,
          json: async () => ({ streamers: [refreshedStreamer] }),
        };
      }
      if (requestUrl === "/api/projects") {
        return { ok: true, json: async () => ({ projects: [] }) };
      }
      if (requestUrl === "/api/applications") {
        return { ok: true, json: async () => ({ applications: [] }) };
      }
      if (requestUrl === "/api/live-tasks") {
        return { ok: true, json: async () => ({ tasks: [] }) };
      }
      if (requestUrl === "/api/live-reports") {
        return { ok: true, json: async () => ({ reports: [] }) };
      }
      if (requestUrl.startsWith("/api/settlement-pool?")) {
        return { ok: true, json: async () => ({ reports: [] }) };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "streamer-edit",
            alias: "Old Streamer",
            real: "Old Real",
            gender: "unknown",
            source: "外部",
            supplier: "未绑定",
            games: ["Old"],
            platforms: ["OldPlatform"],
            style: "OldStyle",
            cooperation: "not_started",
            risk: "low",
            defaultRule: "CPT ¥70/h",
            settlement: {
              method: "cpt",
              cptHourlyRate: 70,
              baseSalary: 0,
              cpsRateBps: 0,
              label: "CPT ¥70/h",
            },
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
            matchScore: 80,
          },
        ]}
        projectCards={[]}
        applicationQueue={[]}
        liveTasks={[]}
        liveReports={[]}
        liveSettlementPool={[]}
        settlementScope={{
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("\u7f16\u8f91\u6863\u6848"));
    fireEvent.change(screen.getByLabelText("\u4e3b\u64ad\u6635\u79f0"), {
      target: { value: "Updated Streamer" },
    });
    fireEvent.change(screen.getByLabelText("\u771f\u5b9e\u59d3\u540d"), {
      target: { value: "Updated Real" },
    });
    fireEvent.change(screen.getByLabelText("\u6765\u6e90"), {
      target: { value: "signed" },
    });
    fireEvent.change(screen.getByLabelText("\u5408\u4f5c\u72b6\u6001"), {
      target: { value: "active" },
    });
    fireEvent.change(screen.getByLabelText("\u64c5\u957f\u54c1\u7c7b"), {
      target: { value: "RPG, Card" },
    });
    fireEvent.change(screen.getByLabelText("\u5e73\u53f0"), {
      target: { value: "Douyin" },
    });
    fireEvent.change(screen.getByLabelText("\u76f4\u64ad\u98ce\u683c"), {
      target: { value: "Story" },
    });
    fireEvent.change(screen.getByLabelText("\u9ed8\u8ba4\u7ed3\u7b97"), {
      target: { value: "cps" },
    });
    fireEvent.change(screen.getByLabelText("CPS \u5206\u6210\u6bd4\u4f8b"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("\u53d8\u66f4\u539f\u56e0"), {
      target: { value: "business closure sync" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "\u4fdd\u5b58\u6863\u6848" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/streamers/streamer-edit",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamers/streamer-edit" &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(patchCall[1].body)).toEqual({
      displayName: "Updated Streamer",
      realName: "Updated Real",
      gender: "unknown",
      sourceType: "signed",
      cooperationStatus: "active",
      categories: ["RPG", "Card"],
      platforms: ["Douyin"],
      styles: ["Story"],
      defaultSettlementMethod: "cps",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 1500,
      reason: "business closure sync",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/streamers", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/applications", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/live-tasks", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/live-reports", undefined);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-pool?periodStart=2026-06-01&periodEnd=2026-06-30",
      undefined,
    );
    expect(await screen.findAllByText("Updated Streamer")).toHaveLength(2);
  });

  it("invites streamer to a selected project", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ application: { id: "app-invite" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="streamers"
        projectCards={[
          {
            id: "project-invite",
            code: "P-INV",
            name: "邀约项目",
            vendor: "厂商",
            product: "产品",
            status: "recruiting",
            pricing: "CPT",
            leadOps: "Ops",
            bizOwner: "Biz",
            start: "2026-06-01",
            end: "2026-06-30",
            streamers: { active: 0, candidate: 0, pendingReview: 0 },
            metrics: {
              plannedHours: 0,
              doneHours: 0,
              audience: 0,
              reportedPending: 0,
              anomalies: 0,
              receivable: 0,
              payable: 0,
              gross: 0,
              margin: 0,
            },
            risk: "low",
          },
        ]}
        streamerCards={[
          {
            id: "streamer-invite",
            alias: "小鹿",
            real: "鹿鸣",
            gender: "女",
            source: "签约",
            supplier: "未绑定",
            games: ["二游"],
            platforms: ["抖音"],
            style: "高能整活",
            cooperation: "active",
            risk: "low",
            defaultRule: "CPT",
            matchScore: 80,
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请加入项目" }));
    fireEvent.click(screen.getByRole("button", { name: "确认邀约" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-invite/invitations",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamerId: "streamer-invite" }),
      }),
    );
    expect(await screen.findByText("已发起邀约")).toBeInTheDocument();
  });

  it("exports streamer pool through governed export", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        export: {
          id: "export-streamers",
          rowCount: 1,
          expiresAt: "2026-06-04",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="streamers"
        streamerCards={[
          {
            id: "streamer-export",
            alias: "小鹿",
            real: "鹿鸣",
            gender: "女",
            source: "签约",
            supplier: "未绑定",
            games: ["二游"],
            platforms: ["抖音"],
            style: "高能整活",
            cooperation: "active",
            risk: "low",
            defaultRule: "CPT",
            matchScore: 80,
            metrics: {
              screenPass: 80,
              projectFinish: 80,
              roi: 1.08,
              grossContrib: 0,
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出主播表" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kind: "project_execution",
      rows: [
        {
          projectName: "主播资源池",
          status: "active",
          operatorName: "小鹿",
        },
      ],
    });
    expect(await screen.findByText("导出已生成")).toBeInTheDocument();
  });
});

describe("OpsReferenceApp admission smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders application queue cards for M3 admission review", () => {
    render(
      <OpsReferenceApp
        initialRoute="admission"
        applicationQueue={[
          {
            id: "app-ui-1",
            status: "pending_recording_review",
            source: "open_signup",
            submittedAt: "2026-06-02T10:00:00.000Z",
            project: { id: "project-1", code: "P2412", name: "元梦之星" },
            streamer: {
              id: "streamer-1",
              displayName: "小鹿",
              cooperationStatus: "active",
              riskLevel: "low",
            },
            latestRecording: {
              id: "recording-ui-1",
              version: 1,
              status: "pending_review",
              durationSeconds: 3660,
              createdAt: "2026-06-02T10:00:00.000Z",
            },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("选播准入").length).toBeGreaterThan(0);
    expect(screen.getByText("app-ui-1")).toBeInTheDocument();
    expect(screen.getByText("元梦之星")).toBeInTheDocument();
    expect(screen.getByText("小鹿")).toBeInTheDocument();
  });
  it("renders the project-first admission board and creates vendor share links", async () => {
    const createObjectURL = vi.fn(() => "blob:admission-recordings");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const clickDownload = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, options) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === "a") {
          element.click = clickDownload;
        }
        return element;
      });
    const admissionApplications = [
      {
        id: "app-ui-1",
        status: "recording_reviewing",
        source: "signup",
        submittedAt: "2026-06-07T01:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: {
          id: "streamer-1",
          displayName: "Streamer One",
          accountLabel: "Douyin / one-live",
        },
        latestRecording: {
          id: "rec-1",
          version: 2,
          status: "reviewing",
          url: "https://video.example/latest",
        },
        vendorReview: null,
      },
      {
        id: "app-ui-2",
        status: "recording_approved",
        source: "direct_invite",
        submittedAt: "2026-06-07T02:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: {
          id: "streamer-2",
          displayName: "Streamer Two",
          accountLabel: "Bilibili / two-live",
        },
        latestRecording: {
          id: "rec-2",
          version: 1,
          status: "approved",
          url: null,
          hasPrivateStorage: true,
        },
        vendorReview: {
          decision: "selected",
          remark: "Good pacing.",
          submittedAt: "2026-06-07T04:00:00.000Z",
        },
      },
      {
        id: "app-ui-3",
        status: "submitted",
        source: "signup",
        submittedAt: "2026-06-07T03:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: {
          id: "streamer-3",
          displayName: "Streamer Three",
          accountLabel: "Kuaishou / three-live",
        },
        latestRecording: null,
        vendorReview: null,
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications/admission-board") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                project: {
                  id: "project-1",
                  code: "P-001",
                  name: "Alpha Project",
                  vendor: "Vendor A",
                  product: "Game A",
                },
                counts: {
                  totalApplications: 2,
                  recordingCount: 2,
                  mcnPendingReview: 1,
                  mcnApproved: 1,
                  mcnRejected: 0,
                  needsChanges: 0,
                  vendorPending: 1,
                  vendorSelected: 1,
                  vendorBackup: 0,
                  vendorRejected: 0,
                  vendorNeedsChanges: 0,
                  pendingFinalConfirm: 1,
                },
                share: {
                  id: "share-1",
                  status: "active",
                  expiresAt: "2026-06-14T00:00:00.000Z",
                  lastSubmittedAt: "2026-06-07T04:00:00.000Z",
                },
                lastActivityAt: "2026-06-07T04:00:00.000Z",
              },
            ],
          }),
        };
      }

      if (String(url) === "/api/applications/app-ui-1/review") {
        return {
          ok: true,
          json: async () => ({
            application: { ...admissionApplications[0], status: "approved" },
          }),
        };
      }

      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({
            applications: admissionApplications.map((application) =>
              application.id === "app-ui-1"
                ? { ...application, status: "recording_approved" }
                : application,
            ),
          }),
        };
      }

      if (String(url) === "/api/exports/admission-recordings") {
        return {
          ok: true,
          json: async () => ({
            export: {
              id: "export-admission",
              filename: "admission.csv",
              content: "项目编号,主播\nP-001,Streamer One",
            },
          }),
        };
      }

      if (String(url) === "/api/projects/project-1/admission-share-boards") {
        return {
          ok: true,
          json: async () => ({
            shareUrl: "https://share.example/admission/plain-token",
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="admission"
        applicationQueue={admissionApplications}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/admission-board",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    expect(screen.getAllByText("Alpha Project").length).toBeGreaterThan(0);
    expect(await screen.findByText("厂家已选 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看录屏" }));
    expect(await screen.findByText("Streamer Two")).toBeInTheDocument();
    expect(await screen.findByText("Good pacing.")).toBeInTheDocument();
    const reviewingRow = screen.getByText("Streamer One").closest("tr");
    const approvedRow = screen.getByText("Streamer Two").closest("tr");

    expect(reviewingRow).not.toBeNull();
    expect(approvedRow).not.toBeNull();
    expect(
      within(approvedRow).queryByRole("button", { name: "通过" }),
    ).not.toBeInTheDocument();
    expect(
      within(approvedRow).queryByRole("button", { name: "驳回" }),
    ).not.toBeInTheDocument();
    expect(
      within(approvedRow).queryByRole("button", { name: "需补充" }),
    ).not.toBeInTheDocument();
    expect(
      within(approvedRow).getByRole("button", { name: "二次确认" }),
    ).toBeInTheDocument();

    fireEvent.click(within(reviewingRow).getByRole("button", { name: "通过" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/app-ui-1/review",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const reviewCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/applications/app-ui-1/review" &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(reviewCall[1].body)).toEqual({
      decision: "approved",
      note: "经营端选播准入审核",
    });
    expect(await screen.findByText("录屏已通过")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出录屏表" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exports/admission-recordings",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const exportCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/exports/admission-recordings",
    );
    expect(JSON.parse(exportCall[1].body)).toEqual({ projectId: "project-1" });
    expect(await screen.findByText(/admission.csv/)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickDownload).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:admission-recordings");
    createElement.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/admission-share-boards",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const shareCall = fetchMock.mock.calls.find(
      ([url]) =>
        String(url) === "/api/projects/project-1/admission-share-boards",
    );
    expect(JSON.parse(shareCall[1].body)).toEqual({
      title: "Alpha Project 录屏复核",
      applicationIds: ["app-ui-2"],
      allowVendorSubmit: true,
    });
    expect(
      await screen.findByText(
        /https:\/\/share.example\/admission\/plain-token/,
      ),
    ).toBeInTheDocument();
  });

  it("creates a project-level share board when server board rows have recordings but the local queue is stale", async () => {
    const staleApplications = [
      {
        id: "app-stale",
        status: "recording_reviewing",
        source: "signup",
        submittedAt: "2026-06-07T01:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-1", displayName: "Streamer One" },
        latestRecording: null,
        vendorReview: null,
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications/admission-board") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                project: {
                  id: "project-1",
                  code: "P-001",
                  name: "Alpha Project",
                  vendor: "Vendor A",
                  product: "Game A",
                },
                counts: {
                  totalApplications: 1,
                  recordingCount: 1,
                  mcnPendingReview: 0,
                  mcnApproved: 1,
                  mcnRejected: 0,
                  needsChanges: 0,
                  vendorPending: 1,
                  vendorSelected: 0,
                  vendorBackup: 0,
                  vendorRejected: 0,
                  vendorNeedsChanges: 0,
                  pendingFinalConfirm: 0,
                },
                share: {
                  id: null,
                  status: "unshared",
                  expiresAt: null,
                  lastSubmittedAt: null,
                },
                lastActivityAt: "2026-06-07T01:00:00.000Z",
              },
            ],
          }),
        };
      }
      if (String(url) === "/api/projects/project-1/admission-share-boards") {
        return {
          ok: true,
          json: async () => ({
            shareUrl: "https://share.example/admission/project-token",
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="admission"
        applicationQueue={staleApplications}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/admission-board",
        expect.objectContaining({ method: "GET" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1/admission-share-boards",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const shareCall = fetchMock.mock.calls.find(
      ([url]) =>
        String(url) === "/api/projects/project-1/admission-share-boards",
    );
    expect(JSON.parse(shareCall[1].body)).toEqual({
      title: "Alpha Project 录屏复核",
      allowVendorSubmit: true,
    });
    expect(
      await screen.findByText(
        /https:\/\/share.example\/admission\/project-token/,
      ),
    ).toBeInTheDocument();
  });

  it("blocks creating a vendor share link when no recordings are MCN approved", async () => {
    const unapprovedApplications = [
      {
        id: "app-reviewing",
        status: "recording_reviewing",
        source: "signup",
        submittedAt: "2026-06-07T01:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-1", displayName: "Streamer One" },
        latestRecording: {
          id: "rec-reviewing",
          version: 1,
          status: "submitted",
          url: "https://video.example/reviewing",
        },
        vendorReview: null,
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications/admission-board") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                project: {
                  id: "project-1",
                  code: "P-001",
                  name: "Alpha Project",
                  vendor: "Vendor A",
                  product: "Game A",
                },
                counts: {
                  totalApplications: 1,
                  recordingCount: 1,
                  mcnPendingReview: 1,
                  mcnApproved: 0,
                  mcnRejected: 0,
                  needsChanges: 0,
                  vendorPending: 1,
                  vendorSelected: 0,
                  vendorBackup: 0,
                  vendorRejected: 0,
                  vendorNeedsChanges: 0,
                  pendingFinalConfirm: 0,
                },
                share: {
                  id: null,
                  status: "unshared",
                  expiresAt: null,
                  lastSubmittedAt: null,
                },
                lastActivityAt: "2026-06-07T01:00:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="admission"
        applicationQueue={unapprovedApplications}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/admission-board",
        expect.objectContaining({ method: "GET" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));

    expect(
      await screen.findByText("当前项目暂无 MCN 已通过的可分享录屏"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/admission-share-boards"),
      ),
    ).toBe(false);
  });

  it("shows vendor decisions with the correct MCN next actions", async () => {
    const decisionApplications = [
      {
        id: "app-selected",
        status: "recording_approved",
        source: "signup",
        submittedAt: "2026-06-07T01:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-selected", displayName: "Selected Streamer" },
        latestRecording: { id: "rec-selected", version: 1, status: "approved" },
        vendorReview: {
          decision: "selected",
          remark: "Best fit.",
          submittedAt: "2026-06-07T08:00:00.000Z",
        },
      },
      {
        id: "app-backup",
        status: "recording_approved",
        source: "signup",
        submittedAt: "2026-06-07T02:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-backup", displayName: "Backup Streamer" },
        latestRecording: { id: "rec-backup", version: 1, status: "approved" },
        vendorReview: {
          decision: "backup",
          remark: "Keep as backup.",
          submittedAt: "2026-06-07T08:10:00.000Z",
        },
      },
      {
        id: "app-rejected",
        status: "recording_rejected",
        source: "signup",
        submittedAt: "2026-06-07T03:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-rejected", displayName: "Rejected Streamer" },
        latestRecording: { id: "rec-rejected", version: 1, status: "rejected" },
        vendorReview: {
          decision: "rejected",
          remark: "Quality is not enough.",
          submittedAt: "2026-06-07T08:20:00.000Z",
        },
      },
      {
        id: "app-change",
        status: "recording_required",
        source: "signup",
        submittedAt: "2026-06-07T04:00:00.000Z",
        project: { id: "project-1", code: "P-001", name: "Alpha Project" },
        streamer: { id: "streamer-change", displayName: "Change Streamer" },
        latestRecording: {
          id: "rec-change",
          version: 1,
          status: "needs_changes",
        },
        vendorReview: {
          decision: "needs_changes",
          remark: "Please add gameplay intro.",
          submittedAt: "2026-06-07T08:30:00.000Z",
        },
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/applications/admission-board") {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                project: {
                  id: "project-1",
                  code: "P-001",
                  name: "Alpha Project",
                  vendor: "Vendor A",
                  product: "Game A",
                },
                counts: {
                  totalApplications: 4,
                  recordingCount: 4,
                  mcnPendingReview: 0,
                  mcnApproved: 2,
                  mcnRejected: 1,
                  needsChanges: 1,
                  vendorPending: 0,
                  vendorSelected: 1,
                  vendorBackup: 1,
                  vendorRejected: 1,
                  vendorNeedsChanges: 1,
                  pendingFinalConfirm: 2,
                },
                share: {
                  id: "share-1",
                  status: "active",
                  expiresAt: "2026-06-14T00:00:00.000Z",
                  lastSubmittedAt: "2026-06-07T08:30:00.000Z",
                },
                lastActivityAt: "2026-06-07T08:30:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="admission"
        applicationQueue={decisionApplications}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/admission-board",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "查看录屏" }));

    const selectedRow = screen.getByText("Selected Streamer").closest("tr");
    const backupRow = screen.getByText("Backup Streamer").closest("tr");
    const rejectedRow = screen.getByText("Rejected Streamer").closest("tr");
    const changeRow = screen.getByText("Change Streamer").closest("tr");

    expect(await screen.findByText("厂家已选")).toBeInTheDocument();
    expect(await screen.findByText("Best fit.")).toBeInTheDocument();
    expect(
      within(selectedRow).getByRole("button", {
        name: /邀请进入项目|二次确认/,
      }),
    ).toBeInTheDocument();

    expect(within(backupRow).getByText("厂家备选")).toBeInTheDocument();
    expect(within(backupRow).getByText("Keep as backup.")).toBeInTheDocument();
    expect(
      within(backupRow).queryByRole("button", {
        name: /邀请进入项目|二次确认/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(backupRow).getByText("厂家备选，等待最终名额"),
    ).toBeInTheDocument();

    expect(within(rejectedRow).getByText("厂家拒绝")).toBeInTheDocument();
    expect(
      within(rejectedRow).getByText("Quality is not enough."),
    ).toBeInTheDocument();
    expect(
      within(rejectedRow).getByText("等待主播重新上传"),
    ).toBeInTheDocument();

    expect(within(changeRow).getByText("需修改")).toBeInTheDocument();
    expect(
      within(changeRow).getByText("Please add gameplay intro."),
    ).toBeInTheDocument();
    expect(within(changeRow).getByText("等待主播补充录屏")).toBeInTheDocument();
  });
});

describe("OpsReferenceApp live task smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an ops live task without pulling historical tasks into the queue", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const createdTask = {
      id: "task-ui-created",
      title: "Golden Project · 冷江",
      status: "pending_live",
      projectId: "P-2406",
      projectName: "Golden Project",
      streamerId: "S-001",
      streamerName: "冷江",
      plannedStartAt: `${todayKey}T12:00:00.000Z`,
      plannedEndAt: `${todayKey}T15:30:00.000Z`,
      plannedDuration: 210,
      systemDuration: 0,
      taskType: "project",
    };
    const historicalTask = {
      ...createdTask,
      id: "task-ui-historical",
      title: "Old Project · Old Streamer",
    };
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/live-tasks" &&
        fetchMock.mock.calls.length > 1
      ) {
        return {
          ok: true,
          json: async () => ({ tasks: [historicalTask, createdTask] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ task: createdTask }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      projectId: "project-live",
      streamerId: "streamer-one",
      title: "Fixture Project · Streamer One",
      plannedStartAt: `${todayKey}T12:00:00.000Z`,
      plannedEndAt: `${todayKey}T15:30:00.000Z`,
      plannedDuration: 210,
      type: "project",
      note: "经营端页面创建任务",
    });
    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*1/ }));
    expect(await screen.findByText("task-ui-created")).toBeInTheDocument();
    expect(screen.queryByText("task-ui-historical")).not.toBeInTheDocument();
  });

  it("creates partner collaboration live tasks with collaboration attribution", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        task: {
          id: "task-collaboration",
          title: "Partner Project 路 Streamer One",
          status: "pending_live",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={[]}
        collaborationProjectCards={[
          {
            ...taskProjectCards[0],
            id: "project-collab",
            name: "Partner Project",
            collaborationRole: "partner",
            collaborationId: "agreement-1",
            collaborationAgreementId: "agreement-1",
          },
        ]}
        streamerCards={[
          {
            ...taskStreamerCards[0],
            projects: [
              {
                id: "project-collab",
                code: "COLLAB",
                name: "Partner Project",
                status: "joined",
                settlementHours: 0,
                grossContrib: 0,
              },
            ],
          },
        ]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /新建任务|鏂板缓浠诲姟/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /创建任务|鍒涘缓浠诲姟/ }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        projectId: "project-collab",
        streamerId: "streamer-one",
        collaborationId: "agreement-1",
        plannedStartAt: `${todayKey}T12:00:00.000Z`,
        plannedEndAt: `${todayKey}T15:30:00.000Z`,
      }),
    );
  });

  it("blocks task creation inline when the selected project has no joined streamers", async () => {
    const alertMock = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={[
          {
            ...taskStreamerCards[0],
            projects: [],
          },
        ]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建任务" }));

    expect(
      await screen.findByText(
        "该项目暂无已加入主播，请先在主播资源池邀请并确认加入后再排班。",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("points staff to roster confirmation when a project only has invited streamers", async () => {
    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={[{ ...taskStreamerCards[0], projects: [] }]}
        applicationQueue={[
          {
            id: "application-invited",
            project: {
              id: "project-live",
              code: "PL-001",
              name: "Fixture Project",
            },
            streamer: {
              id: "streamer-one",
              displayName: "Streamer One",
              cooperationStatus: "active",
              riskLevel: "low",
            },
            status: "invited",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));

    expect(
      await screen.findByText(
        "该项目有 1 位待确认主播，请先到项目详情的主播阵容点击确认加入后再排班。",
      ),
    ).toBeInTheDocument();
  });

  it("creates a task for a streamer joined through project applications", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const refreshedTask = {
      id: "task-application-joined",
      title: "Fixture Project · Streamer One",
      status: "pending_live",
      projectId: "project-live",
      projectName: "Fixture Project",
      streamerId: "streamer-one",
      streamerName: "Streamer One",
      plannedStartAt: `${todayKey}T12:00:00.000Z`,
      plannedEndAt: `${todayKey}T15:30:00.000Z`,
      plannedDuration: 210,
      systemDuration: 0,
    };
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/live-tasks" &&
        fetchMock.mock.calls.length > 1
      ) {
        return {
          ok: true,
          json: async () => ({ tasks: [refreshedTask] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ task: refreshedTask }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={[
          {
            ...taskStreamerCards[0],
            projects: [],
          },
        ]}
        applicationQueue={[
          {
            id: "application-joined",
            project: {
              id: "project-live",
              code: "PL-001",
              name: "Fixture Project",
            },
            streamer: {
              id: "streamer-one",
              displayName: "Streamer One",
              cooperationStatus: "active",
              riskLevel: "low",
            },
            status: "joined",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(await screen.findByLabelText("主播")).toHaveValue("streamer-one");
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      projectId: "project-live",
      streamerId: "streamer-one",
    });
  });

  it("submits the selected task type when creating a task", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const refreshedTask = {
      id: "task-training",
      title: "Fixture Project · Streamer One",
      type: "training",
      status: "pending_live",
      projectId: "project-live",
      projectName: "Fixture Project",
      streamerId: "streamer-one",
      streamerName: "Streamer One",
      plannedStartAt: `${todayKey}T12:00:00.000Z`,
      plannedEndAt: `${todayKey}T15:30:00.000Z`,
      plannedDuration: 210,
      systemDuration: 0,
    };
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/live-tasks" &&
        fetchMock.mock.calls.length > 1
      ) {
        return {
          ok: true,
          json: async () => ({ tasks: [refreshedTask] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ task: refreshedTask }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "训练任务" }));
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      type: "training",
    });
  });

  it("creates tasks against the selected project and links the task drawer back to project detail", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const mappedProjectCards = [
      ...taskProjectCards,
      {
        ...taskProjectCards[0],
        id: "project-mapped",
        code: "PM-002",
        name: "Mapped Project",
        vendor: "Mapped Vendor",
        product: "mapped campaign",
        leadOps: "Mapped Ops",
      },
    ];
    const mappedStreamerCards = taskStreamerCards.map((streamer) => ({
      ...streamer,
      projects: [
        ...streamer.projects,
        {
          id: "project-mapped",
          code: "PM-002",
          name: "Mapped Project",
          status: "joined",
          settlementHours: 0,
          grossContrib: 0,
        },
      ],
    }));
    const refreshedTask = {
      id: "task-project-mapped",
      title: "Mapped Project · Streamer One",
      status: "pending_live",
      projectId: "project-mapped",
      projectName: "Mapped Project",
      streamerId: "streamer-one",
      streamerName: "Streamer One",
      plannedStartAt: `${todayKey}T12:00:00.000Z`,
      plannedEndAt: `${todayKey}T15:30:00.000Z`,
      plannedDuration: 210,
      systemDuration: 0,
    };
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/live-tasks" &&
        fetchMock.mock.calls.length > 1
      ) {
        return {
          ok: true,
          json: async () => ({ tasks: [refreshedTask] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ task: refreshedTask }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={mappedProjectCards}
        streamerCards={mappedStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("项目筛选"), {
      target: { value: "project-mapped" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      projectId: "project-mapped",
      streamerId: "streamer-one",
      title: "Mapped Project · Streamer One",
    });

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*1/ }));
    fireEvent.click(await screen.findByText("task-project-mapped"));
    fireEvent.click(await screen.findByRole("button", { name: "查看项目" }));

    expect(await screen.findByText("Mapped Project")).toBeInTheDocument();
    expect(screen.getAllByText(/PM-002/).length).toBeGreaterThan(0);
  });

  it("creates a batch live schedule without pulling historical tasks into the queue", async () => {
    const promptMock = vi.fn();
    vi.stubGlobal("prompt", promptMock);
    const refreshedTasks = [
      {
        id: "task-ui-batch-1",
        title: "原神 · 4.7 版本品宣专项 · 冷江",
        status: "pending_live",
        projectId: "P-2406",
        projectName: "原神 · 4.7 版本品宣专项",
        streamerId: "S-001",
        streamerName: "冷江",
        plannedStartAt: "2026-05-27T12:00:00.000Z",
        plannedEndAt: "2026-05-27T15:30:00.000Z",
        plannedDuration: 210,
        systemDuration: 0,
      },
      {
        id: "task-ui-batch-2",
        title: "原神 · 4.7 版本品宣专项 · 小Mei",
        status: "pending_live",
        projectId: "P-2406",
        projectName: "原神 · 4.7 版本品宣专项",
        streamerId: "S-002",
        streamerName: "小Mei",
        plannedStartAt: "2026-05-27T12:00:00.000Z",
        plannedEndAt: "2026-05-27T15:30:00.000Z",
        plannedDuration: 210,
        systemDuration: 0,
      },
    ];
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({ tasks: refreshedTasks }),
        };
      }

      return {
        ok: true,
        json: async () => ({ tasks: refreshedTasks }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "批量排班" }));
    fireEvent.change(await screen.findByLabelText("排班日期"), {
      target: { value: "2026-05-27" },
    });
    fireEvent.change(screen.getByLabelText("批量排班主播"), {
      target: { value: "streamer-one,streamer-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认批量排班" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(promptMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks/batch",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tasks: [
        {
          projectId: "project-live",
          streamerId: "streamer-one",
          title: "Fixture Project · Streamer One",
          plannedStartAt: "2026-05-27T12:00:00.000Z",
          plannedEndAt: "2026-05-27T15:30:00.000Z",
          plannedDuration: 210,
          note: "经营端批量排班创建",
        },
        {
          projectId: "project-live",
          streamerId: "streamer-two",
          title: "Fixture Project · Streamer Two",
          plannedStartAt: "2026-05-27T12:00:00.000Z",
          plannedEndAt: "2026-05-27T15:30:00.000Z",
          plannedDuration: 210,
          note: "经营端批量排班创建",
        },
      ],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /任务列表\s*2/ }),
    );
    expect(await screen.findByText("task-ui-batch-1")).toBeInTheDocument();
    expect(await screen.findByText("task-ui-batch-2")).toBeInTheDocument();
  });

  it("filters the task table by streamer and status and marks Excel import pending", () => {
    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "task-filter-one",
            name: "Fixture Project · Streamer One",
            status: "pending_live",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-one",
            streamerName: "Streamer One",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            type: "project",
          },
          {
            id: "task-filter-two",
            name: "Fixture Project · Streamer Two",
            status: "pending_report",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-two",
            streamerName: "Streamer Two",
            dayIdx: 2,
            startHour: 21,
            endHour: 23,
            type: "project",
          },
        ]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*2/ }));
    fireEvent.change(screen.getByLabelText("主播筛选"), {
      target: { value: "streamer-two" },
    });
    expect(screen.getByText("task-filter-two")).toBeInTheDocument();
    expect(screen.queryByText("task-filter-one")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("状态筛选"), {
      target: { value: "pending_live" },
    });
    expect(screen.getByText("暂无数据")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("主播筛选"), {
      target: { value: "all" },
    });
    expect(screen.getByText("task-filter-one")).toBeInTheDocument();
    expect(screen.queryByText("task-filter-two")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "从 Excel 导入" }));
    expect(screen.getByText("Excel 导入后台暂未接入")).toBeInTheDocument();
  });

  it("keeps overdue pending-live status synced between the schedule board and task drawer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T13:12:00.000Z"));
    const statusLabel = "\u5df2\u5ef6\u671f\u672a\u76f4\u64ad";

    try {
      render(
        <OpsReferenceApp
          initialRoute="tasks"
          liveTasks={[
            {
              id: "task-overdue-live",
              name: "Delayed Task",
              status: "pending_live",
              project: "project-live",
              projectId: "project-live",
              projectName: "Fixture Project",
              streamerId: "streamer-one",
              streamerName: "Streamer One",
              dayIdx: 1,
              startHour: 20,
              endHour: 22,
              plannedStartAt: "2026-06-04T12:00:00.000Z",
              plannedEndAt: "2026-06-04T15:30:00.000Z",
              plannedDuration: 210,
              type: "project",
            },
          ]}
          projectCards={taskProjectCards}
          streamerCards={taskStreamerCards}
          applicationQueue={[]}
        />,
      );

      const scheduleTask = screen.getByRole("button", {
        name: /Delayed Task/,
      });
      expect(within(scheduleTask).getByText(statusLabel)).toBeInTheDocument();

      fireEvent.click(scheduleTask);
      const drawer = screen.getByRole("dialog");
      expect(within(drawer).getAllByText(statusLabel).length).toBeGreaterThan(
        0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts overdue pending-live tasks as anomalies in the MCN task module", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T13:12:00.000Z"));

    try {
      render(
        <OpsReferenceApp
          initialRoute="tasks"
          liveTasks={[
            {
              id: "task-overdue-anomaly",
              name: "Overdue Task",
              status: "pending_live",
              project: "project-live",
              projectId: "project-live",
              projectName: "Fixture Project",
              streamerId: "streamer-one",
              streamerName: "Streamer One",
              dayIdx: 1,
              startHour: 20,
              endHour: 22,
              plannedStartAt: "2026-06-04T12:00:00.000Z",
              plannedEndAt: "2026-06-04T15:30:00.000Z",
              plannedDuration: 210,
              type: "project",
            },
          ]}
          projectCards={taskProjectCards}
          streamerCards={taskStreamerCards}
          applicationQueue={[]}
        />,
      );

      expect(
        screen.getByRole("button", {
          name: /\u5f02\u5e38\u4efb\u52a1\s*1/,
        }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows overdue pending-live tasks in the anomaly task list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T13:12:00.000Z"));
    const statusLabel = "\u5df2\u5ef6\u671f\u672a\u76f4\u64ad";

    try {
      render(
        <OpsReferenceApp
          initialRoute="tasks"
          liveTasks={[
            {
              id: "task-overdue-list",
              name: "Overdue List Task",
              status: "pending_live",
              project: "project-live",
              projectId: "project-live",
              projectName: "Fixture Project",
              streamerId: "streamer-one",
              streamerName: "Streamer One",
              dayIdx: 1,
              startHour: 20,
              endHour: 22,
              plannedStartAt: "2026-06-04T12:00:00.000Z",
              plannedEndAt: "2026-06-04T15:30:00.000Z",
              plannedDuration: 210,
              type: "project",
            },
          ]}
          projectCards={taskProjectCards}
          streamerCards={taskStreamerCards}
          applicationQueue={[]}
        />,
      );

      fireEvent.change(screen.getByLabelText("\u72b6\u6001\u7b5b\u9009"), {
        target: { value: "missed_live" },
      });
      expect(
        screen.getByRole("button", { name: /Overdue List Task/ }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", {
          name: /\u5f02\u5e38\u4efb\u52a1\s*1/,
        }),
      );

      expect(screen.getByText(/Overdue List Task/)).toBeInTheDocument();
      expect(screen.getAllByText(statusLabel).length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks anomaly actions and new task draft saves as explicit pending states", async () => {
    const fetchMock = vi.fn(async (url) => {
      const requested = String(url);
      if (requested === "/api/anomalies/scan") {
        return {
          ok: true,
          json: async () => ({
            result: {
              detectedCount: 1,
              changedFields: ["notifications"],
            },
          }),
        };
      }
      if (requested.endsWith("/resolve-anomaly")) {
        return { ok: true, json: async () => ({ task: { id: "task-anomaly-one" } }) };
      }
      if (requested === "/api/live-tasks") {
        return { ok: true, json: async () => ({ tasks: [] }) };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "task-anomaly-one",
            name: "Fixture Project · Streamer One",
            status: "pending_report",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-one",
            streamerName: "Streamer One",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            type: "project",
            anomaly: "late_report",
          },
        ]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /异常任务\s*1/ }));
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/anomalies/scan",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/异常扫描完成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "标记处理" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-tasks/task-anomaly-one/resolve-anomaly",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/已标记处理/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "保存草稿" }));
    expect(
      await screen.findByText("任务草稿保存后台暂未接入。"),
    ).toBeInTheDocument();
  });

  it("keeps a streamer-updated task visible and refreshes only its status", async () => {
    vi.useFakeTimers();
    const initialTask = {
      id: "task-refresh-status",
      name: "Refresh Status Task",
      status: "live",
      project: "project-live",
      projectId: "project-live",
      projectName: "Fixture Project",
      streamerId: "streamer-one",
      streamerName: "Streamer One",
      dayIdx: 1,
      startHour: 20,
      endHour: 22,
      type: "project",
    };
    const refreshedTask = {
      id: "task-refresh-status",
      title: "Refresh Status Task",
      status: "pending_report",
      taskType: "project",
      projectId: "project-live",
      projectName: "Fixture Project",
      streamerId: "streamer-one",
      streamerName: "Streamer One",
      plannedStartAt: "2026-06-02T12:00:00.000Z",
      plannedEndAt: "2026-06-02T14:00:00.000Z",
      plannedDuration: 120,
      systemDuration: 120,
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({ tasks: [refreshedTask] }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(
        <OpsReferenceApp
          initialRoute="tasks"
          liveTasks={[initialTask]}
          projectCards={taskProjectCards}
          streamerCards={taskStreamerCards}
          applicationQueue={[]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /任务列表/ }));
      expect(screen.getByText("task-refresh-status")).toBeInTheDocument();
      expect(
        screen.getByRole("row", { name: /task-refresh-status.*直播中/ }),
      ).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(15000);
      });
      vi.useRealTimers();

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/live-tasks", undefined),
      );
      expect(screen.getByText("task-refresh-status")).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole("row", { name: /task-refresh-status.*待报数/ }),
        ).toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an ops live task from the task drawer then refreshes the queue", async () => {
    const initialTask = {
      id: "task-ui-cancel",
      name: "Golden Project · 冷江",
      status: "pending_live",
      project: "P-2406",
      projectName: "Golden Project",
      streamerId: "S-001",
      streamerName: "冷江",
      dayIdx: 2,
      startHour: 20,
      endHour: 23.5,
      type: "project",
    };
    const refreshedTask = {
      ...initialTask,
      status: "cancelled",
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({ tasks: [refreshedTask] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ task: refreshedTask }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[initialTask]}
        projectCards={[]}
        streamerCards={[]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*1/ }));
    fireEvent.click(screen.getByText("task-ui-cancel"));
    fireEvent.click(await screen.findByRole("button", { name: "取消任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks/task-ui-cancel/cancel",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "经营端页面取消任务" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/live-tasks", undefined);

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*1/ }));
    expect((await screen.findAllByText("已取消")).length).toBeGreaterThan(0);
  });
});

describe("OpsReferenceApp settlement smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders report badges for newer backend report statuses", () => {
    render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: "report-pending-confirm",
            date: "2026-06-02",
            streamer: "Streamer Confirm",
            project: "Project Confirm",
            taskId: "task-pending-confirm",
            duration: 2,
            audience: 900,
            status: "pending_confirm",
            screens: 1,
            source: "OCR",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /全部/ }));

    expect(screen.getAllByText("待确认").length).toBeGreaterThan(0);
  });

  it("renders settlement batch badges for voided batches", () => {
    render(
      <OpsReferenceApp
        initialRoute="settle"
        liveBatches={[
          {
            id: "batch-voided",
            projectId: "project-real",
            type: "streamer_payable",
            name: "Voided payable batch",
            project: "Real Project",
            vendor: "-",
            period: "2026-06-01 -> 2026-06-30",
            items: 1,
            amount: 6789,
            status: "voided",
            updated: "2026-06-03 10:00",
            creator: "Finance",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("已作废").length).toBeGreaterThan(0);
  });

  it("derives settlement summary metrics from live batches instead of fixed display amounts", () => {
    render(
      <OpsReferenceApp
        initialRoute="settle"
        liveBatches={[
          {
            id: "batch-real-receivable",
            projectId: "project-real",
            type: "vendor_receivable",
            name: "Real Project vendor receivable",
            project: "Real Project",
            vendor: "Real Vendor",
            period: "2026-06-01 -> 2026-06-30",
            items: 2,
            amount: 12345,
            status: "generated",
            updated: "2026-06-03 10:00",
            creator: "Finance",
          },
          {
            id: "batch-real-payable-locked",
            projectId: "project-real",
            type: "streamer_payable",
            name: "Real Project streamer payable",
            project: "Real Project",
            vendor: "-",
            period: "2026-06-01 -> 2026-06-30",
            items: 1,
            amount: 6789,
            status: "locked",
            updated: "2026-06-03 11:00",
            creator: "Finance",
          },
          {
            id: "batch-real-payable-generated",
            projectId: "project-real",
            type: "streamer_payable",
            name: "Real Project generated payable",
            project: "Real Project",
            vendor: "-",
            period: "2026-06-01 -> 2026-06-30",
            items: 1,
            amount: 1000,
            status: "generated",
            updated: "2026-06-03 12:00",
            creator: "Finance",
          },
        ]}
        liveSettlementPool={[
          {
            id: "pool-real-one",
            streamer: "Streamer One",
            project: "Real Project",
            hours: 2,
            evidence: "green -> system",
            rule: "cpt",
            expected: 160,
            approvedAt: "2026-06-03 09:00",
          },
          {
            id: "pool-real-two",
            streamer: "Streamer Two",
            project: "Real Project",
            hours: 1,
            evidence: "yellow -> screenshot",
            rule: "cpt",
            expected: 80,
            approvedAt: "2026-06-03 09:30",
          },
        ]}
        settlementScope={{
          projectId: "project-real",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 5,
        }}
      />,
    );

    const metricFor = (label) => screen.getByText(label).parentElement;
    expect(metricFor("本月厂家应收 (草稿)")).toHaveTextContent("¥12,345");
    expect(metricFor("本月主播应付 (锁定)")).toHaveTextContent("¥6,789");
    expect(metricFor("本月预估毛利")).toHaveTextContent("¥5,556");
    expect(metricFor("本月预估毛利")).toHaveTextContent("毛利率 45.0%");
    expect(screen.getByText("1 个应收批次")).toBeInTheDocument();
    expect(screen.getByText("1 个锁定批次")).toBeInTheDocument();
    expect(screen.queryByText("¥286,400")).not.toBeInTheDocument();
    expect(screen.queryByText("¥92,400")).not.toBeInTheDocument();
    expect(screen.queryByText("¥73,200")).not.toBeInTheDocument();
  });

  it("exports filtered report details through governed export", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ export: { id: "export-reports" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: "report-export-one",
            date: "2026-06-02",
            streamer: "Streamer Export",
            project: "Project Export",
            taskId: "task-export-one",
            duration: 2,
            audience: 900,
            status: "pending_review",
            screens: 1,
            source: "OCR",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出报数明细" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kind: "report_details",
      rows: [
        {
          streamerName: "Streamer Export",
          settlementDuration: 2,
          evidenceLevel: "OCR · pending_review",
        },
      ],
    });
    expect(await screen.findByText("报数明细导出已生成")).toBeInTheDocument();
  });

  it("polls streamer-submitted reports into the pending review queue with task details", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-reports") {
        return {
          ok: true,
          json: async () => ({
            reports: [
              {
                id: "report-refresh-queue",
                taskId: "task-refresh-status",
                projectId: "project-live",
                streamerId: "streamer-one",
                status: "pending_review",
                taskTitle: "Refresh Status Task",
                projectName: "Fixture Project",
                streamerName: "Streamer One",
                settlementDuration: 120,
                timeSource: "system",
                evidenceLevel: "green",
                viewers: 900,
                submittedAt: "2026-06-02T14:05:00.000Z",
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(<OpsReferenceApp initialRoute="reports" liveReports={[]} />);

      act(() => {
        vi.advanceTimersByTime(15000);
      });
      vi.useRealTimers();

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/live-reports", undefined),
      );
      expect(
        await screen.findByText("report-refresh-queue"),
      ).toBeInTheDocument();
      expect(screen.getByText("task-refresh-status")).toBeInTheDocument();
      expect(screen.getByText("Streamer One")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("batch approves visible pending reports through the review API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/live-reports/")) {
        return {
          ok: true,
          json: async () => ({ report: { status: "approved" } }),
        };
      }
      if (String(url) === "/api/live-reports") {
        return {
          ok: true,
          json: async () => ({
            reports: [
              {
                id: "report-ui-smoke-approve",
                taskId: "task-ui-smoke-1",
                projectId: "project-1",
                streamerId: "streamer-1",
                status: "approved",
                taskTitle: "Golden Project · 主播一号",
                projectName: "Golden Project",
                streamerName: "主播一号",
                settlementDuration: 120,
                timeSource: "system",
                evidenceLevel: "green",
                viewers: 900,
                submittedAt: "2026-06-02T12:00:00.000Z",
              },
            ],
          }),
        };
      }
      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({ tasks: [] }),
        };
      }
      if (String(url) === "/api/projects") {
        return {
          ok: true,
          json: async () => ({ projects: [] }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: "report-batch-one",
            date: "2026-06-02",
            streamer: "Batch Streamer One",
            project: "Batch Project",
            taskId: "task-batch-one",
            duration: 2,
            audience: 900,
            status: "pending_review",
            screens: 1,
            source: "OCR",
          },
          {
            id: "report-batch-two",
            date: "2026-06-02",
            streamer: "Batch Streamer Two",
            project: "Batch Project",
            taskId: "task-batch-two",
            duration: 1.5,
            audience: 700,
            status: "pending_review",
            screens: 1,
            source: "manual",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "批量审核通过" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live-reports/report-batch-one/review",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/live-reports/report-batch-two/review",
      expect.objectContaining({ method: "PATCH" }),
    );
    const reviewBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/api/live-reports/"))
      .map(([, init]) => JSON.parse(init.body));
    expect(reviewBodies).toEqual([
      expect.objectContaining({ decision: "approve" }),
      expect.objectContaining({ decision: "approve" }),
    ]);
    expect(await screen.findByText(/批量审核已通过 2 条/)).toBeInTheDocument();
  });

  it("runs auto review evaluation and reads rollout readiness from M5", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/auto-review/evaluate") {
        return {
          ok: true,
          json: async () => ({
            result: {
              decision: "auto_pass_candidate",
              mode: "shadow",
              reasons: ["green_evidence"],
            },
          }),
        };
      }
      if (String(url).startsWith("/api/auto-review/rollout-metrics")) {
        return {
          ok: true,
          json: async () => ({
            result: {
              gate: {
                allowed: false,
                targetMode: "active",
                effectiveMode: "gray",
                reasons: ["active_requires_explicit_request"],
              },
              metrics: {
                summary: {
                  shadowSampleCount: 64,
                  falseAcceptRateBps: 40,
                  auditSampleCount: 22,
                  auditErrorRateBps: 120,
                },
              },
            },
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: "report-auto-review-one",
            date: "2026-06-02",
            streamer: "Auto Review Streamer",
            project: "Auto Review Project",
            taskId: "task-auto-review-one",
            duration: 2,
            plannedDuration: 120,
            systemDuration: 120,
            audience: 900,
            status: "pending_review",
            evidenceLevel: "green",
            timeSource: "system",
            screens: 1,
            source: "OCR",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "自动审核评估" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auto-review/evaluate",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      report: {
        id: "report-auto-review-one",
        status: "pending_review",
        evidenceLevel: "green",
        settlementDuration: 120,
      },
      rule: {
        mode: "shadow",
      },
    });
    expect(await screen.findByText(/自动审核评估完成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "审核门槛" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auto-review/rollout-metrics"),
        expect.objectContaining({ method: "GET" }),
      ),
    );
    expect(await screen.findByText(/gray/)).toBeInTheDocument();
  });

  it("approves a pending report then refreshes project, M4, M5, and M6 data from the API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url).includes("/api/live-reports/report-ui-smoke-approve/review")
      ) {
        return {
          ok: true,
          json: async () => ({
            report: {
              id: "report-ui-smoke-approve",
              status: "approved",
              settlementDuration: 120,
              timeSource: "system",
              evidenceLevel: "green",
              viewers: 900,
              enterSettlementPool: true,
            },
          }),
        };
      }

      if (String(url) === "/api/live-reports") {
        return {
          ok: true,
          json: async () => ({ reports: [] }),
        };
      }

      if (String(url) === "/api/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "task-ui-smoke-1",
                title: "Golden Project · 主播一号",
                status: "completed",
                taskType: "project",
                projectId: "project-1",
                projectName: "Golden Project",
                streamerId: "streamer-1",
                streamerName: "主播一号",
                plannedStartAt: "2026-06-02T10:00:00.000Z",
                plannedEndAt: "2026-06-02T12:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 120,
              },
            ],
          }),
        };
      }

      if (String(url).startsWith("/api/settlement-pool?")) {
        return {
          ok: true,
          json: async () => ({
            reports: [
              {
                id: "report-ui-smoke-approve",
                streamerName: "主播一号",
                projectName: "Golden Project",
                settlementDuration: 120,
                timeSource: "system",
                evidenceLevel: "green",
                settlementMethod: "cpt",
                expectedAmount: 160,
                approvedAt: "2026-06-02T12:00:00.000Z",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="reports"
        liveReports={[
          {
            id: "report-ui-smoke-approve",
            date: "2026-06-02",
            streamer: "主播一号",
            streamerId: "streamer-1",
            project: "Golden Project",
            taskId: "task-ui-smoke-1",
            duration: 2,
            audience: 900,
            status: "pending_review",
            screens: 1,
            source: "OCR",
            note: "system · green",
          },
        ]}
        liveSettlementPool={[]}
        settlementScope={{
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 0,
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /待审核/ })).toHaveTextContent(
        "1",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "审核通过" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/live-reports/report-ui-smoke-approve/review",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "经营端页面审核",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/live-reports", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/live-tasks", undefined);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-pool?periodStart=2026-06-01&periodEnd=2026-06-30&projectId=project-1",
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);

    fireEvent.click(screen.getByRole("button", { name: "结算中心" }));

    expect(
      await screen.findByText("report-ui-smoke-approve"),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 条待入批次")).toBeInTheDocument();
  });

  it("creates a payable settlement batch then refreshes project, M6 list, detail, and pool data", async () => {
    const promptMock = vi.fn();
    vi.stubGlobal("prompt", promptMock);

    const apiBatch = {
      id: "batch-ui-smoke-1",
      projectId: "project-1",
      batchType: "payable",
      status: "generated",
      projectName: "Golden Project",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      computedAmount: 160,
      manualAmount: 0,
      adjustmentAmount: 0,
      totalAmount: 160,
      itemCount: 1,
      createdBy: "Ops",
      createdAt: "2026-06-02T12:20:00.000Z",
      updatedAt: "2026-06-02T12:20:00.000Z",
    };
    const apiItems = [
      {
        id: "item-ui-smoke-1",
        batchId: "batch-ui-smoke-1",
        itemType: "live_report",
        streamerName: "主播一号",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        systemAmount: 160,
        manualAmount: 0,
        adjustmentAmount: 0,
        totalAmount: 160,
      },
    ];

    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/settlement-batches") {
        const method = init?.method;
        if (method === "POST") {
          return {
            ok: true,
            json: async () => ({
              batch: apiBatch,
              items: apiItems,
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({ batches: [apiBatch] }),
        };
      }

      if (String(url) === "/api/settlement-batches/batch-ui-smoke-1") {
        return {
          ok: true,
          json: async () => ({
            batch: apiBatch,
            items: apiItems,
          }),
        };
      }

      if (String(url).startsWith("/api/settlement-pool?")) {
        return {
          ok: true,
          json: async () => ({ reports: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="settle"
        liveBatches={[]}
        liveBatchDetails={{}}
        liveSettlementPool={[
          {
            id: "report-ui-smoke-1",
            streamer: "主播一号",
            project: "Golden Project",
            hours: 2,
            evidence: "green · system",
            rule: "cpt",
            expected: 160,
            approvedAt: "2026-06-02 20:10",
          },
        ]}
        settlementScope={{
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建结算批次" }));
    fireEvent.click(screen.getByRole("button", { name: "确认新建批次" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(promptMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          batchType: "payable",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches",
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches/batch-ui-smoke-1",
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-pool?periodStart=2026-06-01&periodEnd=2026-06-30&projectId=project-1",
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);

    expect(await screen.findAllByText("batch-ui-smoke-1")).toHaveLength(2);
    expect(await screen.findByText("暂无待入批次")).toBeInTheDocument();
    expect(screen.queryByText("report-ui-smoke-1")).not.toBeInTheDocument();
  });

  it("focuses settlement details by project and saves project settlement rules", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/projects/project-alpha/settlement-rule") {
        return {
          ok: true,
          json: async () => ({
            project: {
              id: "project-alpha",
              default_settlement_method: "base_salary_cpt",
            },
          }),
        };
      }

      if (String(url) === "/api/projects") {
        return {
          ok: true,
          json: async () => ({ projects: projectManagementCards }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="settle"
        projectCards={projectManagementCards}
        liveBatches={[
          {
            id: "batch-alpha-payable",
            projectId: "project-alpha",
            type: "streamer_payable",
            name: "Alpha Launch · streamer payable",
            project: "Alpha Launch",
            vendor: "—",
            period: "2026-06-01 → 2026-06-30",
            items: 2,
            amount: 15000,
            status: "generated",
            updated: "2026-06-12 10:00",
            creator: "Ops A",
          },
          {
            id: "batch-beta-payable",
            projectId: "project-beta",
            type: "streamer_payable",
            name: "Beta Growth · streamer payable",
            project: "Beta Growth",
            vendor: "—",
            period: "2026-06-01 → 2026-06-30",
            items: 1,
            amount: 3000,
            status: "generated",
            updated: "2026-06-12 11:00",
            creator: "Ops B",
          },
        ]}
        liveSettlementPool={[
          {
            id: "pool-alpha-one",
            projectId: "project-alpha",
            streamer: "Alpha Streamer",
            project: "Alpha Launch",
            hours: 2,
            evidence: "green · system",
            rule: "cpt",
            expected: 160,
            approvedAt: "2026-06-12 09:00",
          },
          {
            id: "pool-beta-one",
            projectId: "project-beta",
            streamer: "Beta Streamer",
            project: "Beta Growth",
            hours: 1,
            evidence: "yellow · screenshot",
            rule: "manual",
            expected: 0,
            approvedAt: "2026-06-12 09:30",
          },
        ]}
        settlementScope={{
          projectId: "project-alpha",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 2,
        }}
      />,
    );

    expect(await screen.findByText("项目结算详情")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha Launch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("batch-alpha-payable").length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("pool-alpha-one")).toBeInTheDocument();
    expect(screen.queryByText("batch-beta-payable")).not.toBeInTheDocument();
    expect(screen.queryByText("pool-beta-one")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存项目规则" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-alpha/settlement-rule",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      defaultSettlementMethod: "cpt",
      reason: "结算中心项目规则调整",
    });
    expect(await screen.findByText("项目结算规则已保存")).toBeInTheDocument();
  });

  it("adds a manual settlement item then refreshes the active batch instead of reloading", async () => {
    const promptMock = vi.fn();
    vi.stubGlobal("prompt", promptMock);
    const reloadMock = vi.fn();
    vi.stubGlobal("location", { reload: reloadMock });

    const apiBatch = {
      id: "batch-ui-smoke-manual",
      projectId: "project-1",
      batchType: "payable",
      status: "generated",
      projectName: "Golden Project",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      computedAmount: 0,
      manualAmount: 300,
      adjustmentAmount: 0,
      totalAmount: 300,
      itemCount: 1,
      createdBy: "Ops",
      updatedAt: "2026-06-02T12:30:00.000Z",
    };
    const apiItems = [
      {
        id: "item-ui-manual-1",
        batchId: "batch-ui-smoke-manual",
        itemType: "cpa",
        streamerName: "人工承载",
        settlementDuration: 0,
        timeSource: "manual",
        evidenceLevel: "red",
        systemAmount: 0,
        manualAmount: 300,
        adjustmentAmount: 0,
        totalAmount: 300,
      },
    ];

    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) ===
        "/api/settlement-batches/batch-ui-smoke-manual/manual-items"
      ) {
        return {
          ok: true,
          json: async () => ({ item: apiItems[0] }),
        };
      }

      if (String(url) === "/api/settlement-batches/batch-ui-smoke-manual") {
        return {
          ok: true,
          json: async () => ({
            batch: apiBatch,
            items: apiItems,
          }),
        };
      }

      if (String(url) === "/api/settlement-batches") {
        return {
          ok: true,
          json: async () => ({ batches: [apiBatch] }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="settle"
        liveBatches={[
          {
            id: "batch-ui-smoke-manual",
            projectId: "project-1",
            type: "streamer_payable",
            name: "Golden Project · 主播应付",
            project: "Golden Project",
            vendor: "—",
            period: "2026-06-01 → 2026-06-30",
            items: 0,
            amount: 0,
            status: "generated",
            updated: "2026-06-02 20:20",
            creator: "Ops",
          },
        ]}
        liveBatchDetails={{ "batch-ui-smoke-manual": [] }}
        liveSettlementPool={[]}
        settlementScope={{
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 0,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "导入 CPA / CPS 数据" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认导入人工金额" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(promptMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches/batch-ui-smoke-manual/manual-items",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "cpa",
          manualAmount: 300,
          evidenceLevel: "red",
          reason: "人工录入 CPA/CPS/礼物金额",
          projectId: "project-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches/batch-ui-smoke-manual",
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches",
      undefined,
    );
    expect(await screen.findByText("item-ui-manual-1")).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

describe("OpsReferenceApp audit center smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders safe audit DTOs with high-risk reasons and changed field names", () => {
    render(
      <OpsReferenceApp
        initialRoute="audit"
        auditEntries={[
          {
            id: "audit-ui-1",
            module: "settlement",
            action: "lock",
            objectType: "settlement_batch",
            objectId: "batch-ui-risk",
            projectId: "project-1",
            actorUserId: "user-owner",
            actorName: "负责人",
            actorRole: "owner",
            changedFields: ["status", "locked_at"],
            isHighRisk: true,
            reason: "财务核对无误后锁定",
            createdAt: "2026-06-02T12:40:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("audit-ui-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("settlement / lock").length).toBeGreaterThan(0);
    expect(screen.getAllByText("batch-ui-risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("财务核对无误后锁定").length).toBeGreaterThan(0);
    expect(screen.getAllByText("status, locked_at").length).toBeGreaterThan(0);
    expect(screen.getAllByText("高风险").length).toBeGreaterThan(0);
    expect(screen.queryByText("before_json")).not.toBeInTheDocument();
    expect(screen.queryByText("after_json")).not.toBeInTheDocument();
  });
});

describe("OpsReferenceApp notification center smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders notification todos and handles a notification through the api", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/notifications/notice-ui-1") {
        return {
          ok: true,
          json: async () => ({
            notification: {
              id: "notice-ui-1",
              title: "结算批次重开",
              status: "handled",
            },
          }),
        };
      }

      if (String(url) === "/api/notifications") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "notice-ui-1",
                type: "high_risk",
                status: "handled",
                title: "结算批次重开",
                content: "批次被 owner 重开",
                objectType: "settlement_batch",
                objectId: "batch-1",
                isHighRisk: true,
                createdAt: "2026-06-02T10:00:00.000Z",
              },
            ],
            unreadCount: 0,
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="notifications"
        notificationItems={[
          {
            id: "notice-ui-1",
            type: "high_risk",
            status: "unread",
            title: "结算批次重开",
            content: "批次被 owner 重开",
            objectType: "settlement_batch",
            objectId: "batch-1",
            isHighRisk: true,
            createdAt: "2026-06-02T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("通知待办").length).toBeGreaterThan(0);
    expect(await screen.findByText("结算批次重开")).toBeInTheDocument();
    expect(await screen.findByText("批次被 owner 重开")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/notice-ui-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "handled" }),
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications", undefined);
    expect((await screen.findAllByText("已处理")).length).toBeGreaterThan(0);
  });
});

describe("OpsReferenceApp export center smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("submits a governed export request and renders the returned filename", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/exports") {
        return {
          ok: true,
          json: async () => ({
            export: {
              kind: "audit_logs",
              filename: "audit_logs-2026-06-02.csv",
              content: "模块,动作\nsettlement,lock",
              fieldCount: 2,
              rowCount: 1,
            },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="export" />);

    expect(screen.getAllByText("数据导出中心").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "生成导出" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exports",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "audit_logs",
            rows: [],
          }),
        }),
      );
    });
    expect(
      await screen.findByText("audit_logs-2026-06-02.csv"),
    ).toBeInTheDocument();
  });

  it("loads vendor delivery package rows before generating a delivery export", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/delivery-packages?projectId=project-live") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                projectId: "project-live",
                projectName: "Fixture Project",
                streamerName: "Streamer One",
                settlementDurationMinutes: 120,
                evidenceLevel: "green",
                screenshotCount: 2,
              },
            ],
          }),
        };
      }
      if (String(url) === "/api/exports") {
        return {
          ok: true,
          json: async () => ({
            export: {
              kind: "vendor_delivery",
              filename: "vendor_delivery-project-live.csv",
              content: "project,streamer",
              fieldCount: 4,
              rowCount: 1,
            },
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp initialRoute="export" projectCards={taskProjectCards} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "厂家交付包" }));
    fireEvent.click(screen.getByRole("button", { name: "生成导出" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/delivery-packages?projectId=project-live",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exports",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const exportCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/exports",
    );
    expect(JSON.parse(exportCall[1].body)).toEqual({
      kind: "vendor_delivery",
      rows: [
        {
          projectId: "project-live",
          projectName: "Fixture Project",
          streamerName: "Streamer One",
          settlementDurationMinutes: 120,
          evidenceLevel: "green",
          screenshotCount: 2,
        },
      ],
    });
    expect(
      await screen.findByText("vendor_delivery-project-live.csv"),
    ).toBeInTheDocument();
  });
});

describe("OpsReferenceApp complex cost smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows complex cost settings in settlement when entitlement is enabled", async () => {
    render(
      <OpsReferenceApp
        initialRoute="settle"
        complexCost={{ enabled: true, includedProjects: 5, usedProjects: 2 }}
      />,
    );

    expect(await screen.findByText("复杂成本规则")).toBeInTheDocument();
    expect(
      await screen.findByText("已用 2 / 5 个项目额度"),
    ).toBeInTheDocument();
  });

  it("submits a complex cost preview from war room", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/projects/project-live/complex-cost-rule/preview"
      ) {
        return {
          ok: true,
          json: async () => ({
            preview: {
              grossMarginCents: 580000,
              marginRateBps: 5800,
              riskNotes: [],
            },
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
      />,
    );
    fireEvent.click(screen.getByText("复杂成本测算"));

    await screen.findByText("毛利率 58.0%");
  });
});

describe("OpsReferenceApp war room smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the war-room surface free of explanatory helper copy", () => {
    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
      />,
    );

    expect(screen.getByText("智能项目作战台")).toBeInTheDocument();
    expect(screen.queryByText(/项目经营决策面板/)).not.toBeInTheDocument();
    expect(screen.queryByText("按风险与履约进度排序")).not.toBeInTheDocument();
    expect(screen.queryByText("基于近 14 天数据")).not.toBeInTheDocument();
    expect(
      screen.queryByText("接入真实项目复盘结果后会展示可执行建议。"),
    ).not.toBeInTheDocument();
  });

  it("exports the daily brief and opens pricing from the header", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/exports") {
        return {
          ok: true,
          json: async () => ({
            export: {
              kind: "project_execution",
              filename: "project_execution-daily.csv",
              rows: [],
              fieldLabels: {},
            },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出当日简报" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exports",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "project_execution",
            rows: [
              {
                projectName: "Fixture Project",
                status: "active",
                operatorName: "Ops",
              },
            ],
          }),
        }),
      );
    });
    expect(
      await screen.findByText(/project_execution-daily\.csv/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立项 / 报价测算" }));
    expect(
      screen.getByRole("button", { name: "生成立项申请" }),
    ).toBeInTheDocument();
  });

  it("binds pricing, matching, and review buttons to war-room APIs", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/war-room/pricing") {
        return {
          ok: true,
          json: async () => ({
            pricing: {
              estimatedDurationMinutes: 6000,
              expectedReceivableCents: 1200000,
              streamerPayableCents: 700000,
              supplierCostCents: 200000,
              platformFeeCents: 0,
              carriedManualRevenueCents: 0,
              manualRevenueEvidenceLevel: "red",
              grossMarginCents: 300000,
              marginRateBps: 2500,
              breakEvenQuoteCents: 900000,
              breakEvenVendorHourlyRateCents: 9000,
              suggestedMinimumQuoteCents: 1125000,
              suggestedMinimumVendorHourlyRateCents: 11250,
              recommendedSettlementMethod: "cpt",
              riskNotes: ["margin_below_target"],
            },
          }),
        };
      }

      if (String(url) === "/api/war-room/matching") {
        return {
          ok: true,
          json: async () => ({
            matches: [
              {
                streamerId: "streamer-api-1",
                streamerName: "接口主播",
                score: 97,
                reasons: ["category_match"],
                riskNotes: [],
                referenceProjects: [],
                suggestedSettlementMethod: "base_salary_cpt",
              },
            ],
            suppliers: [
              {
                supplierId: "supplier-api-1",
                supplierName: "接口供应商",
                score: 89,
                grade: "A",
                reasons: ["high_screening_pass_rate"],
                riskNotes: [],
              },
            ],
          }),
        };
      }

      if (String(url) === "/api/war-room/project-review") {
        return {
          ok: true,
          json: async () => ({
            report: {
              projectId: "project-1",
              projectName: "王者荣耀春节档",
              category: "moba",
              platform: "douyin",
              periodStart: "2026-02-01",
              periodEnd: "2026-02-07",
              streamerCount: 2,
              totalDurationMinutes: 1800,
              totalViews: 170000,
              effectiveManualRevenueCents: 80000,
              receivableCents: 1200000,
              payableCents: 600000,
              supplierCostCents: 100000,
              grossMarginCents: 500000,
              marginRateBps: 4167,
              bestStreamer: {
                streamerId: "streamer-a",
                name: "Ava",
                score: 92,
              },
              worstStreamer: {
                streamerId: "streamer-b",
                name: "Bo",
                score: 48,
              },
              supplierPerformance: [],
              evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
              anomalyCount: 2,
              disputeCount: 1,
              shouldContinue: true,
              nextSuggestedQuoteCents: 1320000,
              nextRoundRecommendations: ["retain_best_streamers"],
              riskNotes: [],
            },
          }),
        };
      }

      if (String(url) === "/api/projects/project-live/invitations") {
        return {
          ok: true,
          json: async () => ({
            application: {
              id: "application-war-room-invite",
              streamerId: "streamer-api-1",
              projectId: "project-live",
            },
          }),
        };
      }

      if (String(url) === "/api/applications") {
        return {
          ok: true,
          json: async () => ({ applications: [] }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看完整复盘" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/war-room/project-review",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("复盘结论：继续投入")).toBeInTheDocument();
    expect(await screen.findByText("13,200.00 元")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /主播匹配引擎/ }));
    fireEvent.click(screen.getByRole("button", { name: "导出厂家候选包" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/war-room/matching",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("接口主播")).toBeInTheDocument();
    expect(await screen.findByText("接口供应商")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发起邀约" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-live/invitations",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ streamerId: "streamer-api-1" }),
        }),
      ),
    );
    expect(await screen.findByText("已发起邀约")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "报价 & 测算" }));
    fireEvent.click(screen.getByRole("button", { name: "生成立项申请" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/war-room/pricing",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("11,250.00 元")).toBeInTheDocument();
    expect(await screen.findByText("margin_below_target")).toBeInTheDocument();
  });

  it("exposes the implemented AI copilot and script routes from M10", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/ai/briefs") {
        return {
          ok: true,
          json: async () => ({
            candidateAdvice: [
              {
                streamerName: "AI Brief Streamer",
                recommendation: "invite",
              },
            ],
            tradeoffAdvice: null,
          }),
        };
      }
      if (String(url) === "/api/ai/project-reviews") {
        return {
          ok: true,
          json: async () => ({
            report: {
              projectName: "AI Review Project",
              shouldContinue: true,
              nextSuggestedQuoteCents: 1280000,
            },
          }),
        };
      }
      if (String(url) === "/api/ai/copilot") {
        return {
          ok: true,
          json: async () => ({
            copilotSummary: {
              title: "Script optimization brief",
              status: "needs_review",
              nextStep: "Review draft before saving",
            },
          }),
        };
      }
      if (String(url) === "/api/ai/scripts") {
        return {
          ok: true,
          json: async () => ({
            scriptVersionDraft: {
              scriptKey: "opening-hook",
              version: 2,
              status: "draft",
              content: "Opening hook: tested draft",
            },
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="warroom"
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI Copilot" }));

    fireEvent.click(screen.getByRole("button", { name: "生成 AI Brief" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/briefs",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/AI Brief Streamer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 项目复盘" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/project-reviews",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/AI Review Project/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行 Copilot" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/copilot",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText(/Script optimization brief/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成脚本草稿" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/scripts",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/Opening hook/)).toBeInTheDocument();
  });
});

describe("OpsReferenceApp billing smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders M11 billing status and refreshes it through the billing API", async () => {
    const initialBilling = {
      subscriptionStatus: "past_due",
      mode: "read_only",
      plan: { tier: "pro", code: "pro", name: "专业版" },
      entitlements: {
        project_management: true,
        settlement: true,
        export_center: true,
        war_room: true,
        auto_review_shadow: true,
        auto_review_active: false,
        ai_diagnosis: true,
        vendor_portal: false,
        private_deployment: false,
      },
      usage: [
        {
          metric: "export",
          usedQuantity: 130,
          includedQuantity: 100,
          addonQuantity: 20,
          allowanceQuantity: 120,
          remainingQuantity: 0,
          overageQuantity: 10,
          billableOverageQuantity: 10,
          softOverage: true,
          shouldHardBlock: false,
        },
      ],
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/billing/status") {
        return {
          ok: true,
          json: async () => ({
            billing: {
              ...initialBilling,
              subscriptionStatus: "active",
              mode: "active",
              plan: { tier: "enterprise", code: "enterprise", name: "企业版" },
              usage: [
                {
                  metric: "ai",
                  usedQuantity: 30,
                  includedQuantity: 100,
                  addonQuantity: 20,
                  allowanceQuantity: 120,
                  remainingQuantity: 90,
                  overageQuantity: 0,
                  billableOverageQuantity: 0,
                  softOverage: true,
                  shouldHardBlock: false,
                },
              ],
            },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp initialRoute="billing" billingStatus={initialBilling} />,
    );

    expect(screen.getAllByText("商业化与套餐").length).toBeGreaterThan(0);
    expect(await screen.findByText("专业版")).toBeInTheDocument();
    expect(await screen.findByText("只读模式")).toBeInTheDocument();
    expect(screen.getAllByText("导出中心").length).toBeGreaterThan(0);
    expect(await screen.findByText("10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新账务状态" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/billing/status",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    expect(await screen.findByText("企业版")).toBeInTheDocument();
    expect(screen.getAllByText("活跃").length).toBeGreaterThan(0);
    expect(await screen.findByText("AI 调用")).toBeInTheDocument();
  });

  it("starts a checkout order from the paywall and renders the pay credential", async () => {
    const activeBilling = {
      subscriptionStatus: "active",
      mode: "active",
      autoRenew: true,
      graceUntil: null,
      trialEndsAt: null,
      pendingPlan: null,
      plan: { tier: "pro", code: "pro", name: "专业版" },
      entitlements: {
        project_management: true,
        settlement: true,
        export_center: true,
        war_room: true,
        auto_review_shadow: true,
        auto_review_active: false,
        ai_diagnosis: true,
        vendor_portal: false,
        private_deployment: false,
      },
      usage: [],
    };
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/billing/checkout") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init.body);
        expect(body).toEqual({
          kind: "subscription_renewal",
          target: { planCode: "pro", billingCycle: "monthly" },
        });
        return {
          ok: true,
          json: async () => ({
            order: {
              id: "order-paywall-1",
              kind: "subscription_renewal",
              status: "pending",
              amountCents: 99900,
              currency: "CNY",
            },
            pay: { provider: "mock", params: { type: "qrcode", value: "mock://pay/order-paywall-1" } },
            reused: false,
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp initialRoute="billing" billingStatus={activeBilling} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "续费「专业版」 · ¥999/月" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/mock:\/\/pay\/order-paywall-1/)).toBeInTheDocument();
    expect(screen.getByText(/订单号 order-paywall-1/)).toBeInTheDocument();
  });
});

describe("OpsReferenceApp funnel smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads conversion funnel metrics from the funnel API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/funnel/metrics") {
        return {
          ok: true,
          json: async () => ({
            metrics: {
              counts: {},
              totals: {
                signupCompleted: 4,
                activated: 2,
                firstSettlementBatch: 1,
                paywallShown: 2,
                paywallClicked: 1,
                checkoutStarted: 1,
                subscriptionActivated: 1,
              },
              rates: {
                activationRate: 0.5,
                paywallCtr: 0.4,
                checkoutConversion: 1,
                trialToPaid: 0.25,
              },
              paywallReasons: { trial_ending: 2 },
            },
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="funnel" />);

    expect(await screen.findByText("激活率")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("Trial → Paid")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("OpsReferenceApp org smoke", () => {
  it("filters members through a real role selector and marks org-only actions pending", () => {
    render(<OpsReferenceApp initialRoute="org" />);

    fireEvent.click(screen.getByRole("button", { name: /成员管理/ }));
    fireEvent.change(screen.getByLabelText("角色筛选"), {
      target: { value: "finance" },
    });
    expect(screen.getByLabelText("角色筛选")).toHaveValue("finance");

    fireEvent.click(screen.getByRole("button", { name: "部门" }));
    expect(screen.getByText("部门筛选后台暂未接入。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出成员表" }));
    expect(screen.getByText("成员表导出后台暂未接入。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "权限变更日志" }));
    expect(screen.getAllByText("操作日志 & 审计").length).toBeGreaterThan(0);
  });
});
