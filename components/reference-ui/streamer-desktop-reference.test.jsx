import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StreamerDesktopReferenceApp from "./streamer-desktop-reference";

describe("StreamerDesktopReferenceApp live task smoke", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders live tasks and starts a task through the streamer task API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks/desktop-task-1/start") {
        return {
          ok: true,
          json: async () => ({
            task: { id: "desktop-task-1", status: "live" },
          }),
        };
      }

      if (String(url) === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "desktop-task-1",
                title: "Desktop Project · Streamer",
                status: "live",
                projectName: "Desktop Project",
                plannedStartAt: "2026-06-03T12:00:00.000Z",
                plannedEndAt: "2026-06-03T14:00:00.000Z",
                plannedDuration: 120,
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
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "desktop-task-1",
            projectName: "Desktop Project",
            vendor: "Vendor",
            dateStr: "2026-06-03",
            start: "20:00",
            end: "22:00",
            durationPlan: 2,
            status: "pending_live",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT 80/h",
            note: "Desktop task",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Desktop Project").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "开始直播" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/streamer/live-tasks",
      undefined,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/live-tasks/desktop-task-1/start",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/streamer/live-tasks",
      undefined,
    );
    expect((await screen.findAllByText("直播中")).length).toBeGreaterThan(0);
  });

  it("ends a live task through the streamer task API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/live-tasks/desktop-task-live/stop") {
        return {
          ok: true,
          json: async () => ({
            task: { id: "desktop-task-live", status: "pending_report" },
          }),
        };
      }

      if (String(url) === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "desktop-task-live",
                title: "Desktop Live Project",
                status: "pending_report",
                projectName: "Desktop Live Project",
                plannedStartAt: "2026-06-03T12:00:00.000Z",
                plannedEndAt: "2026-06-03T14:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 120,
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "desktop-task-live",
            projectName: "Desktop Live Project",
            vendor: "Vendor",
            dateStr: "2026-06-03",
            start: "20:00",
            end: "22:00",
            durationPlan: 2,
            status: "live",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT 80/h",
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "结束直播 + 上传截图" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/streamer/live-tasks",
      undefined,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/live-tasks/desktop-task-live/stop",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/streamer/live-tasks",
      undefined,
    );
    expect(
      (await screen.findAllByText("\u5f85\u4e0a\u4f20\u622a\u56fe")).length,
    ).toBeGreaterThan(0);
  });

  it("renders live task service statuses without crashing", () => {
    expect(() =>
      render(
        <StreamerDesktopReferenceApp
          initialRoute="tasks"
          liveTasks={[
            {
              id: "desktop-task-reviewing",
              projectName: "Reviewing Project",
              vendor: "Vendor",
              dateStr: "2026-06-07",
              start: "20:00",
              end: "22:00",
              durationPlan: 2,
              status: "report_pending_review",
              needStartStop: true,
              needScreening: true,
              settleHint: "CPT 80/h",
            },
          ]}
        />,
      ),
    ).not.toThrow();

    expect(screen.getAllByText("\u5ba1\u6838\u4e2d").length).toBeGreaterThan(0);
  });

  it("marks expired pending live tasks as delayed and unavailable", () => {
    vi.setSystemTime(new Date("2026-06-08T00:00:00.000Z"));
    const expiredTask = {
      id: "desktop-task-expired",
      title: "Delayed Project",
      status: "pending_live",
      projectName: "Delayed Project",
      plannedStartAt: "2026-06-07T12:00:00.000Z",
      plannedEndAt: "2026-06-07T15:30:00.000Z",
      plannedDuration: 210,
      systemDuration: 0,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url) === "/api/streamer/live-tasks") {
          return {
            ok: true,
            json: async () => ({ tasks: [expiredTask] }),
          };
        }

        return {
          ok: false,
          json: async () => ({ error: "unexpected request" }),
        };
      }),
    );

    render(
      <StreamerDesktopReferenceApp
        initialRoute="dashboard"
        liveTasks={[expiredTask]}
      />,
    );

    expect(screen.getAllByText("直播已延期").length).toBeGreaterThan(0);
    expect(screen.getByText("不可直播")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看任务" })).toBeNull();
  });

  it("opens the earnings route when the streamer has no settlement batches yet", () => {
    expect(() =>
      render(<StreamerDesktopReferenceApp initialRoute="earnings" />),
    ).not.toThrow();

    expect(screen.getAllByText("结算账单").length).toBeGreaterThan(0);
    expect(screen.getByText("暂无结算批次")).toBeInTheDocument();
  });
});

describe("StreamerDesktopReferenceApp task summary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("summarizes the current streamer task list instead of static weekly copy", () => {
    render(
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "desktop-task-summary-1",
            projectName: "Summary Project",
            vendor: "Vendor",
            dateStr: "2026-06-03",
            start: "20:00",
            end: "22:00",
            durationPlan: 2,
            status: "pending_report",
          },
          {
            id: "desktop-task-summary-2",
            projectName: "Summary Project",
            vendor: "Vendor",
            dateStr: "2026-06-04",
            start: "19:30",
            end: "21:00",
            durationPlan: 1.5,
            status: "pending_live",
          },
        ]}
      />,
    );

    expect(
      screen.getByText("本周累计 2 个任务 · 3.5 h · 1 个待上传截图"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("本周累计 5 个任务 · 18.5 h · 1 个待上传截图"),
    ).not.toBeInTheDocument();
  });

  it("summarizes server live-task DTOs on the first render", () => {
    render(
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "desktop-task-dto-summary-1",
            title: "DTO Project",
            status: "pending_report",
            projectName: "DTO Project",
            plannedStartAt: "2026-06-03T12:00:00.000Z",
            plannedEndAt: "2026-06-03T15:30:00.000Z",
            plannedDuration: 210,
            systemDuration: 0,
          },
        ]}
      />,
    );

    expect(
      screen.getByText("本周累计 1 个任务 · 3.5 h · 1 个待上传截图"),
    ).toBeInTheDocument();
  });

  it("refreshes the task summary from the streamer task API after mount", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "desktop-task-refresh-summary-1",
                title: "Refresh Project",
                status: "pending_report",
                projectName: "Refresh Project",
                plannedStartAt: "2026-06-03T12:00:00.000Z",
                plannedEndAt: "2026-06-03T13:30:00.000Z",
                plannedDuration: 90,
                systemDuration: 0,
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerDesktopReferenceApp initialRoute="tasks" liveTasks={[]} />);

    await waitFor(() =>
      expect(
        screen.getByText("本周累计 1 个任务 · 1.5 h · 1 个待上传截图"),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/streamer/live-tasks",
      undefined,
    );
  });
});

describe("StreamerDesktopReferenceApp rejected report re-upload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a re-upload CTA for a rejected task and accepts a pasted screenshot", async () => {
    const rejectedTask = {
      id: "rejected-task-1",
      projectName: "Rejected Project",
      vendor: "Vendor",
      dateStr: "2026-06-03",
      start: "20:00",
      end: "22:00",
      durationPlan: 2,
      status: "rejected",
      settleHint: "CPT 80/h",
      note: "截图缺少场观",
    };
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/live-tasks") {
        return { ok: true, json: async () => ({ tasks: [rejectedTask] }) };
      }
      return { ok: false, json: async () => ({ error: "unexpected" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        liveTasks={[rejectedTask]}
      />,
    );

    // The rejected task detail offers a re-upload CTA with the reject reason.
    expect(
      await screen.findByText("审核被驳回，请重新上传截图"),
    ).toBeInTheDocument();
    expect(screen.getByText("驳回原因：截图缺少场观")).toBeInTheDocument();

    // Pasting an image into the paste zone stages it for upload.
    const pasteZone = screen.getByRole("button", {
      name: /粘贴截图上传区/,
    });
    const file = new File(["binary"], "shot.png", { type: "image/png" });
    fireEvent.paste(pasteZone, {
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => file }],
      },
    });

    expect(
      await screen.findByRole("button", { name: "重新提交" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/已选择：pasted-\d+\.png/)).toBeInTheDocument();
  });
});

describe("StreamerDesktopReferenceApp notifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the topbar notification badge from current notification items", () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [], unreadCount: 0 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="dashboard"
        notificationItems={[
          {
            id: "notice-unread-1",
            type: "task",
            status: "unread",
            title: "待上传下播截图",
            content: "项目 A 还有 1 个任务需要补截图。",
            objectType: "live_task",
            objectId: "task-1",
            isHighRisk: false,
            createdAt: "2026-06-03T12:00:00.000Z",
          },
          {
            id: "notice-read-1",
            type: "settlement",
            status: "read",
            title: "结算批次已锁定",
            content: "5 月结算批次已锁定，等待复核。",
            objectType: "settlement_batch",
            objectId: "batch-1",
            isHighRisk: false,
            createdAt: "2026-06-02T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("通知 1 条未读")).toBeInTheDocument();
    expect(screen.getByText("待上传下播截图")).toBeInTheDocument();
    expect(screen.getByText("结算批次已锁定")).toBeInTheDocument();
  });

  it("refreshes notification badge and dashboard list from the notification API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/notifications") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "notice-refresh-1",
                type: "task",
                status: "unread",
                title: "报数审核通过",
                content: "你提交的报数已经审核通过。",
                objectType: "live_report",
                objectId: "report-1",
                isHighRisk: false,
                createdAt: "2026-06-03T13:00:00.000Z",
              },
            ],
            unreadCount: 1,
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="dashboard"
        notificationItems={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("通知 1 条未读")).toBeInTheDocument();
      expect(screen.getByText("报数审核通过")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications", undefined);
  });

  it("uses the notification API unread count and items in the topbar", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/notifications") {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "notice-topbar-1",
                type: "task",
                status: "read",
                title: "API topbar notice",
                content: "Real notification from API",
                objectType: "live_task",
                objectId: "task-1",
                isHighRisk: false,
                createdAt: "2026-06-03T13:00:00.000Z",
              },
            ],
            unreadCount: 22,
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
      <StreamerDesktopReferenceApp
        initialRoute="tasks"
        notificationItems={[]}
      />,
    );

    const notificationButton = await screen.findByLabelText(
      "\u901a\u77e5 22 \u6761\u672a\u8bfb",
    );
    fireEvent.click(notificationButton);

    expect(screen.getByText("API topbar notice")).toBeInTheDocument();
    expect(screen.getByText("Real notification from API")).toBeInTheDocument();
  });
});

describe("StreamerDesktopReferenceApp streamer profile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the profile screen from the current streamer profile", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ profile: profileFixture() }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="profile"
        profile={profileFixture({
          alias: "Profile Streamer",
          stats: {
            projectCount: 2,
            recordingCount: 2,
            totalLiveHours: 3.5,
          },
        })}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText("Profile Streamer").length).toBeGreaterThan(0),
    );
    expect(
      screen.getByText((content) => content.includes("Org One")),
    ).toBeInTheDocument();
    expect(screen.getByText("@profile")).toBeInTheDocument();
    expect(screen.getByText("RPG")).toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.queryByText("412.5")).not.toBeInTheDocument();
    expect(screen.queryByText("合作中 · 签约 6 个月")).not.toBeInTheDocument();
  });

  it("refreshes the profile screen from the streamer profile API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/profile") {
        return {
          ok: true,
          json: async () => ({
            profile: profileFixture({
              alias: "Refreshed Streamer",
              platforms: [
                {
                  id: "account-refresh",
                  platform: "Video",
                  account: "@refresh",
                  followers: 88,
                  primary: true,
                  verified: false,
                },
              ],
            }),
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="profile"
        profile={profileFixture({ alias: "Initial Streamer" })}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Refreshed Streamer").length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText("@refresh")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/streamer/profile", undefined);
  });

  it("renders confirmed AI observations on the streamer profile screen", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        profile: profileFixture({
          aiInsights: [
            {
              id: "insight-desktop",
              title: "录屏 AI 观察 · 开场强",
              summary: "开场福利点清晰，评论区回应快。",
              strengths: ["开场钩子强"],
              risks: ["口播节奏略快"],
              recommendations: ["下次复盘重点观察福利点承接"],
              sourceRef: "recording_ai_analyses:analysis-desktop",
              confirmedAtLabel: "2026-06-03",
            },
          ],
        }),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="profile"
        profile={profileFixture({
          aiInsights: [
            {
              id: "insight-desktop",
              title: "录屏 AI 观察 · 开场强",
              summary: "开场福利点清晰，评论区回应快。",
              strengths: ["开场钩子强"],
              risks: ["口播节奏略快"],
              recommendations: ["下次复盘重点观察福利点承接"],
              sourceRef: "recording_ai_analyses:analysis-desktop",
              confirmedAtLabel: "2026-06-03",
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText("AI 观察与建议")).toBeInTheDocument();
    expect(screen.getByText("录屏 AI 观察 · 开场强")).toBeInTheDocument();
    expect(screen.getByText("开场福利点清晰，评论区回应快。")).toBeInTheDocument();
    expect(screen.getByText("下次复盘重点观察福利点承接")).toBeInTheDocument();
    expect(
      screen.getByText("recording_ai_analyses:analysis-desktop"),
    ).toBeInTheDocument();
  });
});

describe("StreamerDesktopReferenceApp recording library", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders recording links as a URL table instead of file upload cards", () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recordings: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[
          {
            id: "recording-link-1",
            product: "Game Alpha",
            category: "ARPG",
            link: "https://videos.example.com/game-alpha",
            month: "2026-06",
            status: "submitted",
            statusLabel: "待审核",
            submittedAt: "2026-06-03T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("产品").length).toBeGreaterThan(0);
    expect(screen.getAllByText("品类").length).toBeGreaterThan(0);
    expect(screen.getAllByText("链接").length).toBeGreaterThan(0);
    expect(screen.getAllByText("月份").length).toBeGreaterThan(0);
    expect(screen.getAllByText("审核状态").length).toBeGreaterThan(0);
    expect(screen.getByText("Game Alpha")).toBeInTheDocument();
    expect(screen.getByText("ARPG")).toBeInTheDocument();
    expect(
      screen.getByText("https://videos.example.com/game-alpha"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-06")).toBeInTheDocument();
    expect(screen.queryByText("支持 MP4 / MOV")).not.toBeInTheDocument();
  });

  it("plays private recording assets inline in the desktop library", () => {
    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[]}
        recordingAssets={[
          {
            id: "asset-desktop-player-1",
            title: "项目录屏 v2",
            reviewStatus: "submitted",
            reviewStatusLabel: "待审核",
            primarySource: {
              previewMode: "private_file",
              downloadUrl: "https://download.local/desktop-player.mp4",
              openUrl: null,
              embedUrl: null,
              provider: "private_storage",
            },
            aiAnalysis: null,
          },
        ]}
      />,
    );

    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "src",
      "https://download.local/desktop-player.mp4",
    );
    expect(screen.getByText("下载原始文件")).toBeInTheDocument();
  });

  it("renders unified recording asset previews on desktop", () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recordings: [], recordingAssets: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        recordingAssets={[
          {
            id: "asset-desktop-1",
            title: "项目录屏 v1",
            reviewStatus: "submitted",
            reviewStatusLabel: "待审核",
            primarySource: {
              previewMode: "private_file",
              downloadUrl: "https://download.local/desktop-demo.mp4",
              openUrl: null,
              embedUrl: null,
              provider: "private_storage",
            },
            aiAnalysis: {
              status: "succeeded",
              statusLabel: "已完成",
              summary: "录屏节奏稳定，适合进入人工复核。",
              scorecard: { rhythm: 82, interaction: 76 },
              dimensions: [
                {
                  key: "rhythm",
                  label: "直播节奏",
                  score: 82,
                  finding: "开场节奏稳定",
                },
              ],
              segments: [
                {
                  id: "segment-1",
                  title: "开场",
                  timeRangeLabel: "00:00 - 02:00",
                  summary: "开场说明清晰",
                  riskLevel: "low",
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("项目录屏 v1")).toBeInTheDocument();
    expect(screen.getByText("原始文件")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载原始文件" })).toHaveAttribute(
      "href",
      "https://download.local/desktop-demo.mp4",
    );
    expect(screen.getByText("AI 分析报告")).toBeInTheDocument();
    expect(
      screen.getByText("录屏节奏稳定，适合进入人工复核。"),
    ).toBeInTheDocument();
    expect(screen.getByText("直播节奏")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("00:00 - 02:00")).toBeInTheDocument();
  });

  it("submits a recording URL row and appends it to the table", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/streamer/recordings" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            recording: {
              id: "recording-link-2",
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

      if (String(url) === "/api/streamer/recordings") {
        return { ok: true, json: async () => ({ recordings: [] }) };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp initialRoute="videos" recordings={[]} />,
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/streamer/recordings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: "Game Beta",
          category: "SLG",
          link: "https://videos.example.com/game-beta",
          month: "2026-06",
        }),
      }),
    );
  });

  it("opens a public recruitment project detail and submits project recording", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/streamer/project-announcements/project-1") {
        return {
          ok: true,
          json: async () => ({
            project: {
              id: "project-1",
              code: "PUB-1",
              name: "Public Project",
              status: "recruiting",
              vendor: "Vendor A",
              product: "Game A",
              publicSummary: "Streamer-facing summary",
              gameDownloadUrl: "https://download.example.com/game-a",
              openSignup: true,
              forceRecording: true,
              applicationId: null,
              applicationStatus: null,
              latestRecordingStatus: null,
              latestRecordingVersion: null,
              decisionReason: null,
              reviewStatusLabel: "待投递",
              canSubmitRecording: true,
            },
          }),
        };
      }

      if (
        String(url) === "/api/streamer/recordings" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            projectRecording: {
              applicationId: "application-1",
              projectId: "project-1",
              recording: {
                id: "recording-1",
                applicationId: "application-1",
                version: 1,
                status: "submitted",
              },
              reviewStatusLabel: "审核中",
            },
          }),
        };
      }

      if (String(url) === "/api/streamer/recordings") {
        return { ok: true, json: async () => ({ recordings: [] }) };
      }

      if (String(url) === "/api/streamer/project-announcements") {
        return {
          ok: true,
          json: async () => ({
            announcements: [
              {
                id: "project-1",
                code: "PUB-1",
                name: "Public Project",
                status: "recruiting",
                vendor: "Vendor A",
                product: "Game A",
                publicSummary: "Streamer-facing summary",
                gameDownloadUrl: "https://download.example.com/game-a",
                openSignup: true,
                forceRecording: true,
                applicationId: "application-1",
                applicationStatus: "recording_reviewing",
                latestRecordingStatus: "submitted",
                latestRecordingVersion: 1,
                decisionReason: null,
                reviewStatusLabel: "审核中",
                canSubmitRecording: false,
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[
          {
            id: "project-1",
            code: "PUB-1",
            name: "Public Project",
            status: "recruiting",
            vendor: "Vendor A",
            product: "Game A",
            publicSummary: "Streamer-facing summary",
            gameDownloadUrl: "https://download.example.com/game-a",
            openSignup: true,
            forceRecording: true,
            applicationId: null,
            applicationStatus: null,
            latestRecordingStatus: null,
            latestRecordingVersion: null,
            decisionReason: null,
            reviewStatusLabel: "待投递",
            canSubmitRecording: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    await screen.findByText("项目详情");
    expect(
      screen.getAllByText("Streamer-facing summary").length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("录屏链接"), {
      target: { value: "https://videos.example.com/project-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交项目录屏" }));

    await waitFor(() => {
      expect(screen.getAllByText("审核中").length).toBeGreaterThan(0);
    });
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamer/recordings" && init?.method === "POST",
    );
    expect(JSON.parse(submitCall[1].body)).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        link: "https://videos.example.com/project-1",
      }),
    );
  });

  it("uploads a raw project recording file before submitting from desktop", async () => {
    const recordingFile = new File(["desktop recording"], "desktop.mp4", {
      type: "video/mp4",
    });
    const fetchMock = vi.fn(async (url, init) => {
      if (
        String(url) === "/api/streamer/project-announcements/project-upload"
      ) {
        return {
          ok: true,
          json: async () => ({
            project: {
              id: "project-upload",
              code: "PUB-U",
              name: "Upload Project",
              status: "recruiting",
              vendor: "Vendor A",
              product: "Game A",
              publicSummary: "Upload project summary",
              gameDownloadUrl: "https://download.example.com/game-a",
              openSignup: true,
              forceRecording: true,
              applicationId: null,
              applicationStatus: null,
              latestRecordingStatus: null,
              latestRecordingVersion: null,
              decisionReason: null,
              reviewStatusLabel: "待投递",
              canSubmitRecording: true,
            },
          }),
        };
      }
      if (String(url) === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "jy-private",
            path: "org-1/recordings/project-upload/desktop.mp4",
            signedUrl: "https://upload.local/desktop.mp4",
          }),
        };
      }
      if (String(url) === "https://upload.local/desktop.mp4") {
        return { ok: true, json: async () => ({}) };
      }
      if (
        String(url) === "/api/streamer/recordings" &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({
            projectRecording: {
              applicationId: "application-upload",
              projectId: "project-upload",
              recording: {
                id: "recording-upload",
                applicationId: "application-upload",
                version: 1,
                status: "submitted",
              },
              reviewStatusLabel: "审核中",
            },
          }),
        };
      }
      if (String(url) === "/api/streamer/recordings") {
        return { ok: true, json: async () => ({ recordings: [] }) };
      }
      if (String(url) === "/api/streamer/project-announcements") {
        return { ok: true, json: async () => ({ announcements: [] }) };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[
          {
            id: "project-upload",
            code: "PUB-U",
            name: "Upload Project",
            status: "recruiting",
            vendor: "Vendor A",
            product: "Game A",
            publicSummary: "Upload project summary",
            gameDownloadUrl: "https://download.example.com/game-a",
            openSignup: true,
            forceRecording: true,
            applicationId: null,
            applicationStatus: null,
            latestRecordingStatus: null,
            latestRecordingVersion: null,
            decisionReason: null,
            reviewStatusLabel: "待投递",
            canSubmitRecording: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    await screen.findByText("项目详情");
    fireEvent.change(screen.getByLabelText("上传原始录屏"), {
      target: { files: [recordingFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交项目录屏" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/streamer/recordings",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/uploads/signed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          category: "recordings",
          ownerId: "project-upload",
          fileName: "desktop.mp4",
          fileSizeBytes: recordingFile.size,
        }),
      }),
    );
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamer/recordings" && init?.method === "POST",
    );
    expect(JSON.parse(submitCall[1].body)).toEqual(
      expect.objectContaining({
        projectId: "project-upload",
        storagePath: "org-1/recordings/project-upload/desktop.mp4",
      }),
    );
  });

  it("rejects oversized recording files inline without starting an upload", async () => {
    const oversizedFile = new File(["stub"], "huge.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(oversizedFile, "size", { value: 314572801 });
    const fetchMock = vi.fn(async (url) => {
      if (
        String(url) === "/api/streamer/project-announcements/project-upload"
      ) {
        return {
          ok: true,
          json: async () => ({
            project: {
              id: "project-upload",
              code: "PUB-U",
              name: "Upload Project",
              status: "recruiting",
              vendor: "Vendor A",
              product: "Game A",
              publicSummary: "Upload project summary",
              gameDownloadUrl: null,
              openSignup: true,
              forceRecording: true,
              applicationId: null,
              applicationStatus: null,
              latestRecordingStatus: null,
              latestRecordingVersion: null,
              decisionReason: null,
              reviewStatusLabel: "待投递",
              canSubmitRecording: true,
            },
          }),
        };
      }
      if (String(url) === "/api/streamer/recordings") {
        return { ok: true, json: async () => ({ recordings: [] }) };
      }
      if (String(url) === "/api/streamer/project-announcements") {
        return { ok: true, json: async () => ({ announcements: [] }) };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[
          {
            id: "project-upload",
            code: "PUB-U",
            name: "Upload Project",
            status: "recruiting",
            vendor: "Vendor A",
            product: "Game A",
            publicSummary: "Upload project summary",
            gameDownloadUrl: null,
            openSignup: true,
            forceRecording: true,
            applicationId: null,
            applicationStatus: null,
            latestRecordingStatus: null,
            latestRecordingVersion: null,
            decisionReason: null,
            reviewStatusLabel: "待投递",
            canSubmitRecording: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    await screen.findByText("项目详情");
    fireEvent.change(screen.getByLabelText("上传原始录屏"), {
      target: { files: [oversizedFile] },
    });

    await screen.findByText("文件超过 300MB 上限");
    expect(screen.queryByText(/已选择/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/uploads/signed",
      expect.anything(),
    );
  });

  it("shows project recording feedback and allows desktop resubmission", () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recordings: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerDesktopReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[
          {
            id: "project-feedback",
            code: "PUB-F",
            name: "Feedback Project",
            status: "recruiting",
            vendor: "Vendor A",
            product: "Game A",
            publicSummary: "Streamer-facing summary",
            gameDownloadUrl: "https://download.example.com/game-a",
            openSignup: true,
            forceRecording: true,
            applicationId: "application-feedback",
            applicationStatus: "recording_required",
            latestRecordingStatus: "needs_changes",
            latestRecordingVersion: 1,
            decisionReason: "Please add gameplay intro.",
            recordingFeedback: "Please add gameplay intro.",
            reviewStatusLabel: "需修改",
            canSubmitRecording: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));

    expect(screen.getByText("Please add gameplay intro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交项目录屏" })).toBeEnabled();
  });
});

describe("StreamerDesktopReferenceApp AI diagnosis", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a question to the diagnosis API and renders the model findings and recommendations", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/ai/diagnosis") {
        return {
          ok: true,
          json: async () => ({
            result: { answer: "" },
            agentOutput: {
              facts: [],
              findings: [
                { summary: "开场互动偏弱，留存信号承压", evidence: [] },
              ],
              caveats: [],
              recommendations: [
                {
                  proposal: "优化开场钩子与互动节奏",
                  expectedImpact: "提升留存信号",
                  requiresHumanApproval: true,
                },
              ],
            },
            validation: { valid: true, errors: [] },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerDesktopReferenceApp initialRoute="ai" />);

    fireEvent.click(screen.getByRole("button", { name: "今晚怎么开播" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/diagnosis",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/留存信号承压/)).toBeInTheDocument();
    expect(screen.getByText(/优化开场钩子与互动节奏/)).toBeInTheDocument();
  });
});

function profileFixture(overrides = {}) {
  return {
    id: "streamer-profile-1",
    alias: "Profile Streamer",
    real: "Real Name",
    gender: "female",
    level: "合作中",
    signedAt: "2026-06-01",
    org: "Org One",
    stats: {
      projectCount: 2,
      recordingCount: 2,
      totalLiveHours: 3.5,
    },
    platforms: [
      {
        id: "account-1",
        platform: "TikTok",
        account: "@profile",
        followers: 12345,
        primary: true,
        verified: true,
      },
    ],
    tags: {
      categories: ["RPG"],
      styles: ["High energy"],
      skills: ["Boss rush"],
      availability: ["Weekdays 19-24"],
      equipment: ["4K camera"],
    },
    settlement: {
      rule: "base 6000 + cpt 80/h",
      cycle: "monthly",
      baseSalary: "6000",
      cpt: "80",
      giftShare: "configured per project",
      bank: "not exposed",
    },
    security: {
      password: "configured",
      mfa: "not configured",
      notifications: "task, review, ai",
      devices: "current session",
    },
    ...overrides,
  };
}
