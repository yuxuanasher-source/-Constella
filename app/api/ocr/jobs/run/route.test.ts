import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { createTencentOcrProvider } from "@/features/ai/providers/tencent-ocr-provider";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  claimRunnableOcrJobs: vi.fn(),
  runOcrJobOnce: vi.fn(),
}));

vi.mock("@/features/ai/providers/tencent-ocr-provider", () => ({
  createTencentOcrProvider: vi.fn(),
  readTencentOcrConfigFromEnv: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("/api/ocr/jobs/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(),
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createTencentOcrProvider).mockReturnValue({
      runGeneralBasicOcr: vi.fn(),
    });
  });

  it("runs the next runnable OCR job and returns safe metadata only", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imageBucket: "evidence-private",
          imagePath: "org/report-screenshots/task-1/end.png",
        },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "needs_confirmation",
      attempt: 1,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      errorCode: "low_confidence",
      errorMessage: "low_provider_confidence",
      payload: {
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      failures: [],
      jobs: [
        {
          id: "job-1",
          status: "needs_confirmation",
          attempt: 1,
          maxAttempts: 3,
          aiInvocationId: "invocation-1",
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          errorCode: "low_confidence",
          errorMessage: "low_provider_confidence",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("org/report-screenshots");
    expect(runOcrJobOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        imageResolver: expect.any(Function),
      }),
    );
  });

  it("continues processing later OCR jobs when one job fails", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-fail",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: { liveReportId: "report-fail" },
      },
      {
        id: "job-ok",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: { liveReportId: "report-ok" },
      },
    ]);
    vi.mocked(runOcrJobOnce)
      .mockRejectedValueOnce(new Error("provider crashed with secret=abc"))
      .mockResolvedValueOnce({
        id: "job-ok",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "succeeded",
        attempt: 1,
        maxAttempts: 3,
        payload: { liveReportId: "report-ok" },
      });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({ limit: 2 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.failures).toEqual([
      {
        jobId: "job-fail",
        errorCode: "runner_failed",
        errorMessage: "provider crashed",
      },
    ]);
    expect(runOcrJobOnce).toHaveBeenCalledTimes(2);
  });

  it("blocks streamers from running OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("blocks finance staff from running OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });
});
