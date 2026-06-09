import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { confirmLiveReportOcrResult } from "@/features/live-operations/live-operations-service";

vi.mock("@/features/live-operations/live-operations-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/live-operations/live-operations-route-utils")
  >("@/features/live-operations/live-operations-route-utils");

  return {
    ...actual,
    actorFromContext: vi.fn(),
    getLiveOperationsRouteContext: vi.fn(),
  };
});

vi.mock("@/features/live-operations/live-operations-service", () => ({
  confirmLiveReportOcrResult: vi.fn(),
}));

const supabase = { client: "supabase" };
const auth = {
  userId: "user-streamer",
  email: "streamer@example.com",
  name: "Streamer",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "streamer" as const,
};
const actor = {
  userId: auth.userId,
  name: auth.name,
  role: auth.role,
  organizationId: auth.organizationId,
  streamerId: "streamer-1",
};
const context = {
  supabase,
  auth,
  repo: { repo: "live-operations" },
  audit: vi.fn(),
  notify: vi.fn(),
};

function postReportOcr(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/live-reports/report-1/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ reportId: "report-1" }) },
  );
}

describe("/api/live-reports/[reportId]/ocr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
  });

  it("confirms OCR values and returns the updated report", async () => {
    vi.mocked(confirmLiveReportOcrResult).mockResolvedValueOnce({
      id: "report-1",
      status: "pending_review",
      screenshotDuration: 78,
      claimedDuration: 80,
      viewers: 320,
    } as never);

    const response = await postReportOcr({
      ocrDuration: 78,
      ocrViewers: 300,
      confirmedDuration: 80,
      confirmedViewers: 320,
      note: "Corrected by streamer",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      report: {
        id: "report-1",
        status: "pending_review",
        screenshotDuration: 78,
        claimedDuration: 80,
        viewers: 320,
      },
    });
    expect(actorFromContext).toHaveBeenCalledWith(context, true);
    expect(confirmLiveReportOcrResult).toHaveBeenCalledWith({
      repo: context.repo,
      audit: expect.any(Function),
      notify: expect.any(Function),
      actor,
      reportId: "report-1",
      input: {
        ocrDuration: 78,
        ocrViewers: 300,
        confirmedDuration: 80,
        confirmedViewers: 320,
        note: "Corrected by streamer",
      },
    });
  });

  it("maps other-streamer confirmation errors through jsonError", async () => {
    vi.mocked(confirmLiveReportOcrResult).mockRejectedValueOnce(
      new Error("Streamers can only confirm their own reports"),
    );

    const response = await postReportOcr({
      confirmedDuration: 80,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Streamers can only confirm their own reports",
    });
  });

  it("requires confirmedDuration", async () => {
    const response = await postReportOcr({
      ocrDuration: 78,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "confirmedDuration is required",
    });
    expect(confirmLiveReportOcrResult).not.toHaveBeenCalled();
  });
});
