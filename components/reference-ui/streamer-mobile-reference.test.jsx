import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StreamerMobileReferenceApp from "./streamer-mobile-reference";

describe("StreamerMobileReferenceApp live fulfillment smoke", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the injected streamer profile in the mobile header", () => {
    render(
      <StreamerMobileReferenceApp
        profile={{
          id: "streamer-profile-1",
          alias: "DaLong",
          real: "Long",
          level: "合作中",
          org: "Org 1",
          platforms: [],
        }}
        liveTasks={[]}
      />,
    );

    expect(screen.getByText("DaLong")).toBeInTheDocument();
    expect(screen.getByText("合作中 · Org 1")).toBeInTheDocument();
    expect(screen.queryByText("\u672a\u767b\u5f55")).not.toBeInTheDocument();
  });

  it("opens the complete task list from the upcoming section action", () => {
    render(
      <StreamerMobileReferenceApp
        liveTasks={[
          {
            id: "mobile-task-today",
            project: "P-TODAY",
            projectName: "Today Quest",
            vendor: "Vendor A",
            date: "今天",
            dateStr: "2026-06-07",
            start: "10:00",
            end: "12:00",
            durationPlan: 2,
            status: "pending_live",
            settleHint: "¥80/h",
          },
          {
            id: "mobile-task-tomorrow",
            project: "P-TOMORROW",
            projectName: "Tomorrow Quest",
            vendor: "Vendor B",
            date: "明天",
            dateStr: "2026-06-08",
            start: "14:00",
            end: "16:00",
            durationPlan: 2,
            status: "pending_live",
            settleHint: "¥90/h",
          },
          {
            id: "mobile-task-review",
            project: "P-REVIEW",
            projectName: "Review Quest",
            vendor: "Vendor C",
            date: "昨天",
            dateStr: "2026-06-06",
            start: "18:00",
            end: "20:00",
            durationPlan: 2,
            status: "pending_review",
            settleHint: "¥100/h",
          },
          {
            id: "mobile-task-later",
            project: "P-LATER",
            projectName: "Later Quest",
            vendor: "Vendor D",
            date: "下周一",
            dateStr: "2026-06-15",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "approved",
            settleHint: "¥110/h",
          },
        ]}
      />,
    );

    expect(screen.queryByText("Later Quest")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));

    expect(screen.getByText("全部任务")).toBeInTheDocument();
    expect(screen.getByText("Later Quest")).toBeInTheDocument();
  });

  it("shows missed live tasks as needing a no-live reason", () => {
    render(
      <StreamerMobileReferenceApp
        liveTasks={[
          {
            id: "mobile-task-missed",
            project: "P-MISSED",
            projectName: "Missed Quest",
            vendor: "Vendor Missed",
            date: "06-04 周四",
            dateStr: "06-04 周四",
            start: "20:00",
            end: "23:30",
            durationPlan: 3.5,
            status: "missed_live",
            settleHint: "CPT · 审核后入池",
            note: "计划窗口已结束，系统未记录开播，请联系运营补充未直播原因。",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));

    expect(screen.getByText("已延期未直播")).toBeInTheDocument();
    expect(screen.getByText(/未直播原因/)).toBeInTheDocument();
  });

  it("shows elapsed start time instead of a future countdown after planned start", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-06-07T13:12:00.000Z").getTime(),
    );

    render(
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "mobile-task-started-window",
            project: "P-TODAY",
            projectName: "Today Quest",
            vendor: "Vendor A",
            date: "今天",
            dateStr: "06-07 周日",
            start: "20:00",
            end: "23:30",
            durationPlan: 3.5,
            status: "pending_live",
            settleHint: "CPT · 审核后入池",
            plannedStartAt: "2026-06-07T12:00:00.000Z",
            plannedEndAt: "2026-06-07T15:30:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.queryByText("距开播还有")).not.toBeInTheDocument();
    expect(screen.getByText("计划已开始")).toBeInTheDocument();
    expect(screen.getByText(/1 小时 12 分钟/)).toBeInTheDocument();
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
      if (requestUrl === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "evidence-private",
            path: "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
            signedUrl:
              "https://upload.local/org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
            token: "token-1",
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
            plannedStartAt: "2026-06-02T11:00:00.000Z",
            plannedEndAt: "2026-06-02T13:00:00.000Z",
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/uploads/signed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "report-screenshots",
          ownerId: "live-task-ui-smoke-1",
          fileName: "manual-submit.png",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/live-tasks/live-task-ui-smoke-1/reports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath:
            "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
          screenshotFileHash: "manual-live-task-ui-smoke-1-1780000000000",
          screenshotDuration: 240,
          claimedDuration: 240,
          viewers: 11240,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/streamer/live-tasks",
      undefined,
    );

    expect(await screen.findByText("报数已提交审核")).toBeInTheDocument();
  }, 15000);

  it("keeps the report submit action visible instead of showing bottom navigation", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="report"
        liveTasks={[
          {
            id: "live-task-report-visible-submit",
            projectName: "Visible Submit Project",
            dateStr: "2026-06-07",
            status: "pending_report",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "\u786e\u8ba4\u65e0\u8bef\uff0c\u63d0\u4ea4\u5ba1\u6838",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "\u4efb\u52a1" }),
    ).not.toBeInTheDocument();
  });
});

describe("StreamerMobileReferenceApp AI diagnosis smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls the streamer diagnosis API and renders the agent answer", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/ai/diagnosis") {
        return {
          ok: true,
          json: async () => ({
            result: {
              answer:
                "Use a shorter opening segment and raise interaction density in the first 10 minutes.",
            },
            agentOutput: {
              summary: "Opening retention is below recent baseline.",
              recommendations: [
                {
                  title: "Raise early interaction",
                  rationale: "Recent room-entry data is below your baseline.",
                },
              ],
            },
            validation: { valid: true, errors: [] },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${url}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerMobileReferenceApp initialRoute="ai" />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Traffic dropped after opening yesterday" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/diagnosis",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      question: "Traffic dropped after opening yesterday",
      source: "streamer_mobile",
    });
    expect(
      await screen.findByText(
        "Use a shorter opening segment and raise interaction density in the first 10 minutes.",
      ),
    ).toBeInTheDocument();
  });
});

describe("StreamerMobileReferenceApp recording smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not render recording instructions on the mobile recording library", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[]}
      />,
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
        projectAnnouncements={[]}
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
        projectAnnouncements={[]}
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
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[]}
      />,
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

  it("renders public project announcements with download link and review status", () => {
    render(
      <StreamerMobileReferenceApp
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
            applicationId: "application-1",
            applicationStatus: "recording_reviewing",
            latestRecordingStatus: "submitted",
            latestRecordingVersion: 1,
            decisionReason: null,
            reviewStatusLabel: "审核中",
            canSubmitRecording: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("项目公告")).toBeInTheDocument();
    expect(screen.getByText("Public Project")).toBeInTheDocument();
    expect(screen.getByText("Streamer-facing summary")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开游戏下载" })).toHaveAttribute(
      "href",
      "https://download.example.com/game-a",
    );
    expect(screen.getByText("审核中")).toBeInTheDocument();
  });

  it("shows project recording feedback and allows mobile resubmission", () => {
    render(
      <StreamerMobileReferenceApp
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

  it("refreshes project announcements when entering videos without initial announcement data", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/project-announcements") {
        return {
          ok: true,
          json: async () => ({
            announcements: [
              {
                id: "project-refresh",
                code: "PUB-R",
                name: "Refreshed Project",
                status: "recruiting",
                vendor: "Vendor R",
                product: "Game R",
                publicSummary: "Fetched project summary",
                gameDownloadUrl: "https://download.example.com/game-r",
                openSignup: true,
                forceRecording: true,
                applicationId: null,
                applicationStatus: null,
                latestRecordingStatus: null,
                latestRecordingVersion: null,
                decisionReason: null,
                reviewStatusLabel: "Pending",
                canSubmitRecording: true,
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerMobileReferenceApp initialRoute="videos" recordings={[]} />,
    );

    expect(await screen.findByText("Refreshed Project")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/streamer/project-announcements",
      undefined,
    );
  });

  it("keeps the videos tab usable when project announcements are forbidden", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/project-announcements") {
        return {
          ok: false,
          json: async () => ({
            error: "Only streamers can access project announcements",
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerMobileReferenceApp initialRoute="videos" recordings={[]} />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/streamer/project-announcements",
        undefined,
      ),
    );
    expect(
      screen.getByText(
        "\u6682\u65e0\u516c\u5f00\u9879\u76ee\u516c\u544a\u3002",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the videos tab usable when recording links are forbidden", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/recordings") {
        return {
          ok: false,
          json: async () => ({
            error: "Only streamers can access recording links",
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        projectAnnouncements={[]}
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/streamer/recordings",
        undefined,
      ),
    );
    expect(
      screen.getByText(
        "\u6682\u65e0\u5f55\u5c4f\u94fe\u63a5\uff0c\u63d0\u4ea4 URL \u540e\u4f1a\u8fdb\u5165\u5ba1\u6838\u5217\u8868\u3002",
      ),
    ).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("submits a project recording from the project detail view", async () => {
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
      <StreamerMobileReferenceApp
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
});

describe("StreamerMobileReferenceApp profile actions smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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
        projectAnnouncements={[]}
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

  it("loads streamer application status from the implemented applications API", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/applications") {
        return {
          ok: true,
          json: async () => ({
            applications: [
              {
                id: "application-mobile-1",
                projectId: "project-mobile-1",
                projectName: "Application Project",
                status: "recording_reviewing",
                statusLabel: "录屏审核中",
                source: "signup",
                submittedAt: "2026-06-03T10:00:00.000Z",
                latestRecordingStatus: "submitted",
                reviewStatusLabel: "审核中",
              },
            ],
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

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
          history: [],
          items: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "报名" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/streamer/applications",
        undefined,
      ),
    );
    expect(await screen.findByText("Application Project")).toBeInTheDocument();
    expect(screen.getByText("录屏审核中")).toBeInTheDocument();
  });
});
