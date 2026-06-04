import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StreamerMobileReferenceApp from "./streamer-mobile-reference";

describe("StreamerMobileReferenceApp live fulfillment smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts, stops, and submits a live report from the streamer task flow", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    const taskState = {
      status: "pending_live",
      systemDuration: 0,
    };
    const refreshedTask = () => ({
      id: "live-task-ui-smoke-1",
      title: "Golden Project · 主播一号",
      status: taskState.status,
      projectName: "Golden Project",
      plannedStartAt: "2026-06-02T11:00:00.000Z",
      plannedEndAt: "2026-06-02T13:00:00.000Z",
      plannedDuration: 120,
      systemDuration: taskState.systemDuration,
    });

    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/start")) {
        taskState.status = "live";
        taskState.systemDuration = 0;
        return {
          ok: true,
          json: async () => ({
            task: {
              id: "live-task-ui-smoke-1",
              status: "live",
              systemDuration: 0,
            },
          }),
        };
      }
      if (requestUrl.endsWith("/stop")) {
        taskState.status = "pending_report";
        taskState.systemDuration = 120;
        return {
          ok: true,
          json: async () => ({
            task: {
              id: "live-task-ui-smoke-1",
              status: "pending_report",
              systemDuration: 120,
            },
          }),
        };
      }
      if (requestUrl.endsWith("/reports")) {
        taskState.status = "report_pending_review";
        taskState.systemDuration = 240;
        return {
          ok: true,
          json: async () => ({
            report: {
              id: "report-ui-smoke-streamer",
              status: "pending_review",
              settlementDuration: 240,
              timeSource: "screenshot",
              evidenceLevel: "yellow",
            },
          }),
        };
      }
      if (requestUrl === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [refreshedTask()],
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
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "live-task-ui-smoke-1",
            project: "P-UI-SMOKE",
            projectName: "Golden Project",
            vendor: "Demo Vendor",
            dateStr: "2026-06-02",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "pending_live",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT ¥80/h",
            note: "UI smoke task",
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "准时点击「开始直播」" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks/live-task-ui-smoke-1/start",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/streamer/live-tasks",
      undefined,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "结束直播 + 上传截图" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/live-tasks/live-task-ui-smoke-1/stop",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/streamer/live-tasks",
      undefined,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "从相册选择截图" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/live-tasks/live-task-ui-smoke-1/reports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath:
            "reports/live-task-ui-smoke-1/manual-submit.png",
          screenshotFileHash: "manual-live-task-ui-smoke-1-1780000000000",
          screenshotDuration: 240,
          claimedDuration: 240,
          viewers: 11240,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/streamer/live-tasks",
      undefined,
    );

    expect(await screen.findByText("报数已提交审核")).toBeInTheDocument();
  });
});

describe("StreamerMobileReferenceApp recording smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not render recording instructions on the mobile recording library", () => {
    render(
      <StreamerMobileReferenceApp initialRoute="videos" recordings={[]} />,
    );

    expect(screen.queryByText("录屏说明")).not.toBeInTheDocument();
  });

  it("renders recording links with the same URL table logic as desktop", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[
          {
            id: "recording-link-mobile-1",
            product: "Game Alpha",
            category: "ARPG",
            link: "https://videos.example.com/mobile-alpha",
            month: "2026-06",
            status: "submitted",
            statusLabel: "待审核",
            submittedAt: "2026-06-03T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Game Alpha")).toBeInTheDocument();
    expect(screen.getByText("ARPG")).toBeInTheDocument();
    expect(
      screen.getByText("https://videos.example.com/mobile-alpha"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("待审核")).toBeInTheDocument();
    expect(screen.queryByLabelText("录屏文件")).not.toBeInTheDocument();
  });

  it("renders streamer recording links on the standalone videos route", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[
          {
            id: "recording-link-ui-1",
            product: "元梦之星 6 月赛事直播",
            category: "赛事",
            link: "https://videos.example.com/yuanmeng-june",
            month: "2026-06",
            status: "reviewing",
            statusLabel: "审核中",
            submittedAt: "2026-06-02T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("元梦之星 6 月赛事直播")).toBeInTheDocument();
    expect(screen.getByText("赛事")).toBeInTheDocument();
    expect(
      screen.getByText("https://videos.example.com/yuanmeng-june"),
    ).toBeInTheDocument();
    expect(screen.getByText("审核中")).toBeInTheDocument();
  });

  it("submits a recording URL row and appends it to the mobile library", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/streamer/recordings" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            recording: {
              id: "recording-link-created",
              product: "Game Beta",
              category: "SLG",
              link: "https://videos.example.com/game-beta",
              month: "2026-06",
              status: "submitted",
              statusLabel: "待审核",
              submittedAt: "2026-06-03T11:00:00.000Z",
            },
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerMobileReferenceApp initialRoute="videos" recordings={[]} />,
    );

    fireEvent.change(screen.getByLabelText("产品"), {
      target: { value: "Game Beta" },
    });
    fireEvent.change(screen.getByLabelText("品类"), {
      target: { value: "SLG" },
    });
    fireEvent.change(screen.getByLabelText("链接"), {
      target: { value: "https://videos.example.com/game-beta" },
    });
    fireEvent.change(screen.getByLabelText("月份"), {
      target: { value: "2026-06" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交录屏链接" }));

    await waitFor(() => {
      expect(screen.getByText("Game Beta")).toBeInTheDocument();
      expect(
        screen.getByText("https://videos.example.com/game-beta"),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/streamer/recordings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      product: "Game Beta",
      category: "SLG",
      link: "https://videos.example.com/game-beta",
      month: "2026-06",
    });
  });
});

describe("StreamerMobileReferenceApp profile actions smoke", () => {
  it("turns profile tool rows into real navigation or visible panels", async () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="me"
        liveEarnings={{
          currentMonth: {
            month: "2026-06",
            earned: 1200,
            pending: 300,
            finalized: false,
            hours: 12,
          },
          lastMonth: {
            month: "2026-05",
            earned: 900,
            hours: 10,
            base: 0,
            variable: 0,
          },
          history: [{ month: "2026-06", earned: 1200 }],
          items: [],
        }}
        recordings={[
          {
            id: "recording-link-profile",
            product: "元梦之星 6 月赛事直播",
            category: "赛事",
            link: "https://videos.example.com/profile-yuanmeng",
            month: "2026-06",
            status: "submitted",
            statusLabel: "待审核",
            submittedAt: "2026-06-03T10:00:00.000Z",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("我的录屏库"));
    expect((await screen.findAllByText("我的录屏")).length).toBeGreaterThan(0);
    expect(screen.getByText("元梦之星 6 月赛事直播")).toBeInTheDocument();
    expect(
      screen.getByText("https://videos.example.com/profile-yuanmeng"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("我的"));
    fireEvent.click(screen.getByText("结算账单"));
    expect(screen.getByText("本月预估")).toBeInTheDocument();

    fireEvent.click(screen.getByText("概览"));
    fireEvent.click(screen.getByText("账号与平台绑定"));
    expect(screen.getByText("平台绑定明细")).toBeInTheDocument();

    fireEvent.click(screen.getByText("隐私与权限"));
    expect(screen.getByText("隐私字段范围")).toBeInTheDocument();

    fireEvent.click(screen.getByText("操作记录"));
    expect(screen.getByText("近期操作记录")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("打开设置"));
    expect(screen.getByText("设置项")).toBeInTheDocument();
  });
});
