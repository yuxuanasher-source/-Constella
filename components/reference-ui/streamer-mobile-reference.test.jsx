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

    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/start")) {
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks/live-task-ui-smoke-1/start",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "结束直播 + 上传截图" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/live-tasks/live-task-ui-smoke-1/stop",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "从相册选择截图" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "确认无误，提交审核" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/live-tasks/live-task-ui-smoke-1/reports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath:
            "demo/reports/live-task-ui-smoke-1/manual-submit.png",
          screenshotFileHash: "manual-live-task-ui-smoke-1-1780000000000",
          screenshotDuration: 240,
          claimedDuration: 240,
          viewers: 11240,
        }),
      }),
    );

    expect(await screen.findByText("报数已提交审核")).toBeInTheDocument();
  });
});
