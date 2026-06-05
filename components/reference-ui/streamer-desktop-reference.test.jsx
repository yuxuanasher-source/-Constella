import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StreamerDesktopReferenceApp from "./streamer-desktop-reference";

describe("StreamerDesktopReferenceApp live task smoke", () => {
  afterEach(() => {
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
