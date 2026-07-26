import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createOcrJob } from "@/features/ai/ocr-jobs";
import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { deleteReportScreenshotForOcr } from "@/features/live-operations/live-operations-repository";
import { submitLiveReportScreenshotForOcr } from "@/features/live-operations/live-operations-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  createOcrJob: vi.fn(),
}));

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
  submitLiveReportScreenshotForOcr: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-repository", () => ({
  deleteReportScreenshotForOcr: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = { client: "supabase" };
const adminSupabase = { client: "admin-supabase" };
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

function postTaskOcr(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/live-tasks/task-1/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ taskId: "task-1" }) },
  );
}

describe("/api/live-tasks/[taskId]/ocr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      adminSupabase as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
    vi.mocked(createOcrJob).mockResolvedValue({
      id: "ocr-job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 0,
      payload: {
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
        expectedDuration: 67,
      },
    });
  });

  it("queues a safe OCR job for a report screenshot", async () => {
    vi.mocked(submitLiveReportScreenshotForOcr).mockImplementationOnce(
      async ({ createOcrJob: queueOcrJob, deleteReportScreenshot, input }) => {
        await deleteReportScreenshot({
          id: "00000000-0000-4000-8000-000000000101",
          organizationId: "org-1",
          liveReportId: "report-1",
          screenshotFileHash: "sha256:abc123",
        });
        const job = await queueOcrJob({
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imageBucket: input.imageBucket,
          imagePath: input.screenshotStoragePath,
          expectedDuration: 67,
        });

        return {
          report: { id: "report-1", status: "ocr_ing" } as never,
          job,
        };
      },
    );

    const response = await postTaskOcr({
      screenshotStoragePath: "org/report-screenshots/task-1/end.png",
      screenshotFileHash: "sha256:abc123",
      imageBucket: "evidence-private",
      collaborationId: "agreement-1",
      imageBase64: "must-not-be-forwarded",
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      report: { id: "report-1", status: "ocr_ing" },
      job: { id: "ocr-job-1", status: "queued" },
    });
    expect(JSON.stringify(body)).not.toContain("imageBase64");

    expect(actorFromContext).toHaveBeenCalledWith(context, true);
    // 一次是入队路由本身，一次是入队后 inline kick 的 runner 身份解析。
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(2);
    expect(submitLiveReportScreenshotForOcr).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.repo,
        actor,
        taskId: "task-1",
        input: {
          screenshotStoragePath: "org/report-screenshots/task-1/end.png",
          screenshotFileHash: "sha256:abc123",
          imageBucket: "evidence-private",
          collaborationId: "agreement-1",
        },
      }),
    );
    expect(createOcrJob).toHaveBeenCalledWith({
      client: adminSupabase,
      actor: auth,
      input: {
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
        expectedDuration: 67,
      },
    });
    expect(deleteReportScreenshotForOcr).toHaveBeenCalledWith(adminSupabase, {
      id: "00000000-0000-4000-8000-000000000101",
      organizationId: "org-1",
      liveReportId: "report-1",
      screenshotFileHash: "sha256:abc123",
    });
    expect(JSON.stringify(vi.mocked(createOcrJob).mock.calls)).not.toContain(
      "must-not-be-forwarded",
    );
  });

  it("maps streamer ownership errors through jsonError", async () => {
    vi.mocked(submitLiveReportScreenshotForOcr).mockRejectedValueOnce(
      new Error("Streamers can only operate their own live tasks"),
    );

    const response = await postTaskOcr({
      screenshotStoragePath: "org/report-screenshots/task-1/end.png",
      screenshotFileHash: "sha256:abc123",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Streamers can only operate their own live tasks",
    });
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("fails safely before report side effects when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValueOnce(null);

    const response = await postTaskOcr({
      screenshotStoragePath: "org/report-screenshots/task-1/end.png",
      screenshotFileHash: "sha256:abc123",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase admin client is unavailable",
    });
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(submitLiveReportScreenshotForOcr).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("requires the screenshot storage path", async () => {
    const response = await postTaskOcr({
      screenshotFileHash: "sha256:abc123",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "screenshotStoragePath is required",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(submitLiveReportScreenshotForOcr).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("requires the screenshot file hash", async () => {
    const response = await postTaskOcr({
      screenshotStoragePath: "org/report-screenshots/task-1/end.png",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "screenshotFileHash is required",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(submitLiveReportScreenshotForOcr).not.toHaveBeenCalled();
  });
});
