import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

describe("OpsReferenceApp project smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(screen.getByText("p-db-1 · PDB-001")).toBeInTheDocument();
    expect(screen.getAllByText("草稿").length).toBeGreaterThan(0);
  });

  it("opens a visible draft form when creating a project", () => {
    vi.stubGlobal("prompt", undefined);

    render(<OpsReferenceApp initialRoute="projects" projectCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByLabelText("项目名称")).toBeInTheDocument();
    expect(screen.getByLabelText("项目编号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建草稿" })).toBeInTheDocument();
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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
    expect((await screen.findAllByText("新建草稿项目")).length).toBeGreaterThan(0);
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
});

describe("OpsReferenceApp live task smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an ops live task then refreshes the M4 task queue", async () => {
    const refreshedTask = {
      id: "task-ui-created",
      title: "Golden Project · 冷江",
      status: "pending_live",
      projectId: "P-2406",
      projectName: "Golden Project",
      streamerId: "S-001",
      streamerName: "冷江",
      plannedStartAt: "2026-05-27T12:00:00.000Z",
      plannedEndAt: "2026-05-27T15:30:00.000Z",
      plannedDuration: 210,
      systemDuration: 0,
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

    render(<OpsReferenceApp initialRoute="tasks" liveTasks={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      projectId: "P-2406",
      streamerId: "S-001",
      title: "原神 · 4.7 版本品宣专项 · 冷江",
      plannedStartAt: "2026-05-27T12:00:00.000Z",
      plannedEndAt: "2026-05-27T15:30:00.000Z",
      plannedDuration: 210,
      note: "经营端页面创建任务",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/live-tasks", undefined);

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*1/ }));
    expect(await screen.findByText("task-ui-created")).toBeInTheDocument();
  });

  it("creates a batch live schedule then refreshes the M4 task queue", async () => {
    const promptValues = [
      "P-2406",
      "S-001,S-002",
      "2026-05-27",
      "20:00",
      "23:30",
    ];
    vi.stubGlobal(
      "prompt",
      vi.fn(() => promptValues.shift() ?? null),
    );
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

    render(<OpsReferenceApp initialRoute="tasks" liveTasks={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "批量排班" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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
          projectId: "P-2406",
          streamerId: "S-001",
          title: "原神 · 4.7 版本品宣专项 · 冷江",
          plannedStartAt: "2026-05-27T12:00:00.000Z",
          plannedEndAt: "2026-05-27T15:30:00.000Z",
          plannedDuration: 210,
          note: "经营端批量排班创建",
        },
        {
          projectId: "P-2406",
          streamerId: "S-002",
          title: "原神 · 4.7 版本品宣专项 · 小Mei",
          plannedStartAt: "2026-05-27T12:00:00.000Z",
          plannedEndAt: "2026-05-27T15:30:00.000Z",
          plannedDuration: 210,
          note: "经营端批量排班创建",
        },
      ],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/live-tasks", undefined);

    fireEvent.click(screen.getByRole("button", { name: /任务列表\s*2/ }));
    expect(await screen.findByText("task-ui-batch-1")).toBeInTheDocument();
    expect(screen.getByText("task-ui-batch-2")).toBeInTheDocument();
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

    render(<OpsReferenceApp initialRoute="tasks" liveTasks={[initialTask]} />);

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
    expect(await screen.findByText("已取消")).toBeInTheDocument();
  });
});

describe("OpsReferenceApp settlement smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("approves a pending report then refreshes M5 and M6 data from the API", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "审核通过" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-pool?projectId=project-1&periodStart=2026-06-01&periodEnd=2026-06-30",
      undefined,
    );

    fireEvent.click(screen.getByRole("button", { name: "结算中心" }));

    expect(
      await screen.findByText("report-ui-smoke-approve"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 条待入批次")).toBeInTheDocument();
  });

  it("creates a payable settlement batch then refreshes M6 list, detail, and pool data", async () => {
    const promptValues = ["project-1", "2026-06-01", "2026-06-30", "payable"];
    vi.stubGlobal(
      "prompt",
      vi.fn(() => promptValues.shift() ?? null),
    );

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
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
      "/api/settlement-pool?projectId=project-1&periodStart=2026-06-01&periodEnd=2026-06-30",
      undefined,
    );

    expect(await screen.findAllByText("batch-ui-smoke-1")).toHaveLength(2);
    expect(screen.getByText("暂无待入批次")).toBeInTheDocument();
    expect(screen.queryByText("report-ui-smoke-1")).not.toBeInTheDocument();
  });

  it("adds a manual settlement item then refreshes the active batch instead of reloading", async () => {
    const promptValues = ["cpa", "300", "red", "人工录入 CPA/CPS/礼物金额"];
    vi.stubGlobal(
      "prompt",
      vi.fn(() => promptValues.shift() ?? null),
    );
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
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
    expect(screen.getByText("结算批次重开")).toBeInTheDocument();
    expect(screen.getByText("批次被 owner 重开")).toBeInTheDocument();

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
            rows: [{ module: "settlement", action: "lock" }],
          }),
        }),
      );
    });
    expect(await screen.findByText("audit_logs-2026-06-02.csv")).toBeInTheDocument();
  });
});
