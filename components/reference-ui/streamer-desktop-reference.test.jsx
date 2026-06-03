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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/live-tasks/desktop-task-1/start",
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
    expect((await screen.findAllByText("直播中")).length).toBeGreaterThan(0);
  });
});
