import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

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
