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
      if (requestUrl === "/api/live-tasks/live-task-ui-smoke-1/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: {
              id: "report-ui-smoke-streamer",
            },
            job: {
              id: "ocr-job-ui-smoke-streamer",
              status: "queued",
            },
          }),
        };
      }
      if (requestUrl === "/api/live-reports/report-ui-smoke-streamer/ocr") {
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

    const screenshotFile = new File(["real screenshot bytes"], "end.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("上传下播截图"), {
      target: { files: [screenshotFile] },
    });
    await screen.findByRole("button", { name: "确认无误，提交审核" });
    expect(
      screen.queryByRole("button", { name: "从相册选择截图" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/uploads/signed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "report-screenshots",
          ownerId: "live-task-ui-smoke-1",
          fileName: "end.png",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "https://upload.local/org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: screenshotFile,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/live-tasks/live-task-ui-smoke-1/ocr",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath:
            "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
          screenshotFileHash:
            "manual-live-task-ui-smoke-1-1780000000000-end.png-21",
          imageBucket: "evidence-private",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "/api/streamer/live-tasks",
      undefined,
    );
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url) === "/api/live-reports/report-ui-smoke-streamer/ocr",
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reports")),
    ).toBe(false);

    expect((await screen.findAllByText("OCR 识别中")).length).toBeGreaterThan(
      0,
    );
  }, 15000);

  it("confirms a queued OCR report after refreshing the OCR result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "evidence-private",
            path: "org-1/report-screenshots/live-task-ocr-confirm/manual-submit.png",
            signedUrl:
              "https://upload.local/org-1/report-screenshots/live-task-ocr-confirm/manual-submit.png",
          }),
        };
      }
      if (
        requestUrl ===
        "https://upload.local/org-1/report-screenshots/live-task-ocr-confirm/manual-submit.png"
      ) {
        return { ok: true, json: async () => ({}) };
      }
      if (requestUrl === "/api/live-tasks/live-task-ocr-confirm/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: { id: "report-ocr-confirm" },
            job: { id: "ocr-job-confirm", status: "queued" },
          }),
        };
      }
      if (requestUrl === "/api/ocr/jobs/ocr-job-confirm") {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-confirm",
              status: "succeeded",
              result: { extractedDuration: 238, extractedViewers: 11240 },
            },
          }),
        };
      }
      if (requestUrl === "/api/live-reports/report-ocr-confirm/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: { id: "report-ocr-confirm", status: "pending_review" },
          }),
        };
      }
      if (requestUrl === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "live-task-ocr-confirm",
                title: "OCR Confirm Project",
                status: "pending_review",
                projectName: "OCR Confirm Project",
                plannedStartAt: "2026-06-02T11:00:00.000Z",
                plannedEndAt: "2026-06-02T13:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 240,
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
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "live-task-ocr-confirm",
            project: "P-OCR-CONFIRM",
            projectName: "OCR Confirm Project",
            vendor: "Demo Vendor",
            dateStr: "2026-06-02",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "pending_report",
            plannedStartAt: "2026-06-02T11:00:00.000Z",
            plannedEndAt: "2026-06-02T13:00:00.000Z",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT 楼80/h",
          },
        ]}
      />,
    );

    const screenshotFile = new File(["ocr confirm screenshot"], "ocr.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("上传下播截图"), {
      target: { files: [screenshotFile] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );
    expect((await screen.findAllByText("OCR 识别中")).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新识别结果" }));
    expect(await screen.findByText("识别完成")).toBeInTheDocument();
    expect(await screen.findByText("238 分钟")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "确认 OCR 结果，提交审核" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url) === "/api/live-reports/report-ocr-confirm/ocr",
        ),
      ).toBe(true),
    );
    const confirmCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/live-reports/report-ocr-confirm/ocr",
    );
    expect(JSON.parse(confirmCall?.[1]?.body)).toEqual({
      ocrDuration: 238,
      ocrViewers: 11240,
      confirmedDuration: 240,
      confirmedViewers: 11240,
      note: "",
    });
    expect(await screen.findByText("报数已提交审核")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reports")),
    ).toBe(false);
  }, 15000);

  it("allows manual confirmation on the queued report when OCR fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "evidence-private",
            path: "org-1/report-screenshots/live-task-ocr-failed/manual-submit.png",
            signedUrl:
              "https://upload.local/org-1/report-screenshots/live-task-ocr-failed/manual-submit.png",
          }),
        };
      }
      if (
        requestUrl ===
        "https://upload.local/org-1/report-screenshots/live-task-ocr-failed/manual-submit.png"
      ) {
        return { ok: true, json: async () => ({}) };
      }
      if (requestUrl === "/api/live-tasks/live-task-ocr-failed/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: { id: "report-ocr-failed" },
            job: { id: "ocr-job-failed", status: "queued" },
          }),
        };
      }
      if (requestUrl === "/api/ocr/jobs/ocr-job-failed") {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-failed",
              status: "failed",
              errorCode: "provider_failed",
            },
          }),
        };
      }
      if (requestUrl === "/api/live-reports/report-ocr-failed/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: { id: "report-ocr-failed", status: "pending_review" },
          }),
        };
      }
      if (requestUrl === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "live-task-ocr-failed",
                title: "OCR Failed Project",
                status: "report_pending_review",
                projectName: "OCR Failed Project",
                plannedStartAt: "2026-06-02T11:00:00.000Z",
                plannedEndAt: "2026-06-02T13:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 240,
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
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "live-task-ocr-failed",
            project: "P-OCR-FAILED",
            projectName: "OCR Failed Project",
            vendor: "Demo Vendor",
            dateStr: "2026-06-02",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "pending_report",
            plannedStartAt: "2026-06-02T11:00:00.000Z",
            plannedEndAt: "2026-06-02T13:00:00.000Z",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT 楼80/h",
          },
        ]}
      />,
    );

    const screenshotFile = new File(["ocr failed screenshot"], "failed.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("上传下播截图"), {
      target: { files: [screenshotFile] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "刷新识别结果" }),
    );
    expect(
      await screen.findByText("识别失败，可按手填值提交"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "按手填值提交审核" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url) === "/api/live-reports/report-ocr-failed/ocr",
        ),
      ).toBe(true),
    );
    const confirmCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/live-reports/report-ocr-failed/ocr",
    );
    expect(JSON.parse(confirmCall?.[1]?.body)).toEqual({
      confirmedDuration: 240,
      confirmedViewers: 11240,
      note: "",
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reports")),
    ).toBe(false);
  }, 15000);

  it("does not submit a duplicate manual report when OCR creation fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "evidence-private",
            path: "org-1/report-screenshots/live-task-fallback/manual-submit.png",
            signedUrl:
              "https://upload.local/org-1/report-screenshots/live-task-fallback/manual-submit.png",
            token: "token-1",
          }),
        };
      }
      if (requestUrl === "/api/live-tasks/live-task-fallback/ocr") {
        return {
          ok: false,
          json: async () => ({ error: "provider_unconfigured" }),
        };
      }
      if (requestUrl === "/api/live-tasks/live-task-fallback/reports") {
        return {
          ok: true,
          json: async () => ({
            report: {
              id: "report-ui-fallback-streamer",
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
            tasks: [
              {
                id: "live-task-fallback",
                title: "Fallback Project",
                status: "pending_review",
                projectName: "Fallback Project",
                plannedStartAt: "2026-06-02T11:00:00.000Z",
                plannedEndAt: "2026-06-02T13:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 240,
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
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "live-task-fallback",
            project: "P-FALLBACK",
            projectName: "Fallback Project",
            vendor: "Demo Vendor",
            dateStr: "2026-06-02",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "pending_report",
            plannedStartAt: "2026-06-02T11:00:00.000Z",
            plannedEndAt: "2026-06-02T13:00:00.000Z",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT ¥80/h",
            note: "Fallback task",
          },
        ]}
      />,
    );

    const screenshotFile = new File(["fallback screenshot"], "fallback.png", {
      type: "image/png",
    });
    fireEvent.change(await screen.findByLabelText("上传下播截图"), {
      target: { files: [screenshotFile] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "provider_unconfigured",
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/uploads/signed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://upload.local/org-1/report-screenshots/live-task-fallback/manual-submit.png",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: screenshotFile,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/live-tasks/live-task-fallback/ocr",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reports")),
    ).toBe(false);
  }, 15000);

  it("does not submit a duplicate manual report when OCR confirmation fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/uploads/signed") {
        return {
          ok: true,
          json: async () => ({
            bucket: "evidence-private",
            path: "org-1/report-screenshots/live-task-confirm-fail/manual-submit.png",
            signedUrl:
              "https://upload.local/org-1/report-screenshots/live-task-confirm-fail/manual-submit.png",
            token: "token-1",
          }),
        };
      }
      if (
        requestUrl ===
        "https://upload.local/org-1/report-screenshots/live-task-confirm-fail/manual-submit.png"
      ) {
        return {
          ok: true,
          json: async () => ({}),
        };
      }
      if (requestUrl === "/api/live-tasks/live-task-confirm-fail/ocr") {
        return {
          ok: true,
          json: async () => ({
            report: {
              id: "report-ui-confirm-fail",
            },
            job: {
              id: "ocr-job-ui-confirm-fail",
              status: "queued",
            },
          }),
        };
      }
      if (requestUrl === "/api/ocr/jobs/ocr-job-ui-confirm-fail") {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-ui-confirm-fail",
              status: "succeeded",
              result: {
                extractedDuration: 240,
                extractedViewers: 11240,
              },
            },
          }),
        };
      }
      if (requestUrl === "/api/live-reports/report-ui-confirm-fail/ocr") {
        return {
          ok: false,
          json: async () => ({ error: "confirm_failed" }),
        };
      }
      if (requestUrl === "/api/streamer/live-tasks") {
        return {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "live-task-confirm-fail",
                title: "Confirm Fail Project",
                status: "report_pending_review",
                projectName: "Confirm Fail Project",
                plannedStartAt: "2026-06-02T11:00:00.000Z",
                plannedEndAt: "2026-06-02T13:00:00.000Z",
                plannedDuration: 120,
                systemDuration: 240,
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
      <StreamerMobileReferenceApp
        initialRoute="task"
        liveTasks={[
          {
            id: "live-task-confirm-fail",
            project: "P-CONFIRM-FAIL",
            projectName: "Confirm Fail Project",
            vendor: "Demo Vendor",
            dateStr: "2026-06-02",
            start: "19:00",
            end: "21:00",
            durationPlan: 2,
            status: "pending_report",
            plannedStartAt: "2026-06-02T11:00:00.000Z",
            plannedEndAt: "2026-06-02T13:00:00.000Z",
            needStartStop: true,
            needScreening: true,
            settleHint: "CPT 楼80/h",
          },
        ]}
      />,
    );

    const screenshotFile = new File(
      ["confirm fail screenshot"],
      "confirm.png",
      {
        type: "image/png",
      },
    );
    fireEvent.change(await screen.findByLabelText("上传下播截图"), {
      target: { files: [screenshotFile] },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "\u786e\u8ba4\u65e0\u8bef\uff0c\u63d0\u4ea4\u5ba1\u6838",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "刷新识别结果" }),
    );
    expect(await screen.findByText("识别完成")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "确认 OCR 结果，提交审核" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "confirm_failed",
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reports")),
    ).toBe(false);
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

  it("plays private recording assets inline and keeps the download link", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[]}
        projectAnnouncements={[]}
        recordingAssets={[
          {
            id: "asset-mobile-player-1",
            title: "项目录屏 v2",
            reviewStatus: "submitted",
            reviewStatusLabel: "待审核",
            primarySource: {
              previewMode: "private_file",
              downloadUrl: "https://download.local/player-demo.mp4",
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
      "https://download.local/player-demo.mp4",
    );
    expect(screen.getByText("下载原始文件")).toBeInTheDocument();
  });

  it("routes the trial task CTA buttons to the recordings tab", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="task"
        recordings={[]}
        projectAnnouncements={[]}
        liveTasks={[
          {
            id: "mobile-task-trial-1",
            project: "P-TRIAL",
            projectName: "Trial Quest",
            vendor: "Vendor T",
            date: "今天",
            dateStr: "06-07 周日",
            start: "20:00",
            end: "22:00",
            durationPlan: 2,
            status: "trial",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "上传录屏" }));
    expect(screen.getByText("录屏资产")).toBeInTheDocument();
  });

  it("renders unified recording asset previews in the mobile recording library", () => {
    render(
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={[]}
        recordingAssets={[
          {
            id: "asset-mobile-1",
            title: "项目录屏 v1",
            reviewStatus: "submitted",
            reviewStatusLabel: "待审核",
            primarySource: {
              previewMode: "private_file",
              downloadUrl: "https://download.local/demo.mp4",
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
        projectAnnouncements={[]}
      />,
    );

    expect(screen.getByText("项目录屏 v1")).toBeInTheDocument();
    expect(screen.getByText("原始文件")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载原始文件" })).toHaveAttribute(
      "href",
      "https://download.local/demo.mp4",
    );
    expect(screen.getByText("AI 分析报告")).toBeInTheDocument();
    expect(
      screen.getByText("录屏节奏稳定，适合进入人工复核。"),
    ).toBeInTheDocument();
    expect(screen.getByText("直播节奏")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("00:00 - 02:00")).toBeInTheDocument();
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
    // 进入「视频」页会先发一次 GET /api/streamer/recordings 重签请求，
    // 所以按调用内容而非调用次序断言 POST。
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/streamer/recordings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(JSON.parse(postCall[1].body)).toEqual({
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

  it("uploads a raw project recording file before submitting the project recording", async () => {
    const recordingFile = new File(["recording bytes"], "demo.mp4", {
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
            path: "org-1/recordings/project-upload/demo.mp4",
            signedUrl: "https://upload.local/demo.mp4",
          }),
        };
      }
      if (String(url) === "https://upload.local/demo.mp4") {
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
      if (String(url) === "/api/streamer/project-announcements") {
        return { ok: true, json: async () => ({ announcements: [] }) };
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
          fileName: "demo.mp4",
          fileSizeBytes: recordingFile.size,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.local/demo.mp4",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: recordingFile,
      }),
    );
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamer/recordings" && init?.method === "POST",
    );
    expect(JSON.parse(submitCall[1].body)).toEqual(
      expect.objectContaining({
        projectId: "project-upload",
        storagePath: "org-1/recordings/project-upload/demo.mp4",
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
      <StreamerMobileReferenceApp
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
      if (String(url) === "/api/streamer/project-announcements") {
        return { ok: true, json: async () => ({ announcements: [] }) };
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

describe("StreamerMobileReferenceApp project signup smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const openProjectAnnouncement = (overrides = {}) => ({
    id: "project-open-1",
    code: "PUB-OPEN",
    name: "Open Signup Project",
    status: "recruiting",
    vendor: "Vendor O",
    product: "Game O",
    publicSummary: "Open project summary",
    gameDownloadUrl: null,
    openSignup: true,
    forceRecording: true,
    applicationId: null,
    applicationStatus: null,
    latestRecordingStatus: null,
    latestRecordingVersion: null,
    decisionReason: null,
    recordingFeedback: null,
    reviewStatusLabel: "待投递",
    canSubmitRecording: true,
    ...overrides,
  });

  it("renders signup entries and disables projects that already applied or joined", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === "/api/streamer/applications") {
        return { ok: true, json: async () => ({ applications: [] }) };
      }
      if (String(url) === "/api/streamer/project-announcements") {
        return {
          ok: true,
          json: async () => ({
            announcements: [
              openProjectAnnouncement(),
              openProjectAnnouncement({
                id: "project-applied-1",
                code: "PUB-APPLIED",
                name: "Applied Project",
                applicationId: "application-applied-1",
                applicationStatus: "recording_reviewing",
                reviewStatusLabel: "审核中",
                canSubmitRecording: false,
              }),
              openProjectAnnouncement({
                id: "project-joined-1",
                code: "PUB-JOINED",
                name: "Joined Project",
                applicationId: "application-joined-1",
                applicationStatus: "joined",
                reviewStatusLabel: "已加入项目",
                canSubmitRecording: false,
              }),
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerMobileReferenceApp initialRoute="me" />);

    fireEvent.click(screen.getByRole("button", { name: "报名" }));

    expect(await screen.findByText("可报名项目")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "立即报名" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "已报名" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "已加入项目" })).toBeDisabled();
    expect(screen.getByText("录屏审核中")).toBeInTheDocument();
  });

  it("applies to an open project and refreshes the signup status", async () => {
    let applied = false;
    const fetchMock = vi.fn(async (url, init) => {
      const href = String(url);
      if (href === "/api/streamer/applications") {
        return {
          ok: true,
          json: async () => ({
            applications: applied
              ? [
                  {
                    id: "application-new-1",
                    projectId: "project-open-1",
                    projectName: "Open Signup Project",
                    status: "submitted",
                    statusLabel: "待审核",
                    source: "signup",
                    submittedAt: "2026-07-02T10:00:00.000Z",
                    latestRecordingStatus: null,
                    reviewStatusLabel: "暂无录屏",
                  },
                ]
              : [],
          }),
        };
      }
      if (href === "/api/streamer/project-announcements") {
        return {
          ok: true,
          json: async () => ({
            announcements: [
              openProjectAnnouncement(
                applied
                  ? {
                      applicationId: "application-new-1",
                      applicationStatus: "submitted",
                      reviewStatusLabel: "待投递",
                    }
                  : {},
              ),
            ],
          }),
        };
      }
      if (
        href === "/api/projects/project-open-1/applications" &&
        init?.method === "POST"
      ) {
        applied = true;
        return {
          ok: true,
          json: async () => ({
            application: {
              id: "application-new-1",
              projectId: "project-open-1",
              streamerId: "streamer-1",
              source: "signup",
              status: "submitted",
            },
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerMobileReferenceApp initialRoute="me" />);

    fireEvent.click(screen.getByRole("button", { name: "报名" }));

    fireEvent.click(await screen.findByRole("button", { name: "立即报名" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-open-1/applications",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    expect(
      await screen.findByText("报名成功：已提交「Open Signup Project」，等待运营审核。"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "已报名" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "立即报名" }),
    ).not.toBeInTheDocument();
    expect(await screen.findAllByText("Open Signup Project")).toHaveLength(2);
    expect(screen.getAllByText("待审核").length).toBeGreaterThan(0);
  });

  it("keeps the signup entry usable when applying fails", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const href = String(url);
      if (href === "/api/streamer/applications") {
        return { ok: true, json: async () => ({ applications: [] }) };
      }
      if (href === "/api/streamer/project-announcements") {
        return {
          ok: true,
          json: async () => ({ announcements: [openProjectAnnouncement()] }),
        };
      }
      if (
        href === "/api/projects/project-open-1/applications" &&
        init?.method === "POST"
      ) {
        return {
          ok: false,
          json: async () => ({ error: "Project is not open for signup" }),
        };
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerMobileReferenceApp initialRoute="me" />);

    fireEvent.click(screen.getByRole("button", { name: "报名" }));

    fireEvent.click(await screen.findByRole("button", { name: "立即报名" }));

    expect(await screen.findByText("该项目暂未开放报名。")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "立即报名" }),
    ).toBeEnabled();
  });
});
