import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { createTencentOcrProvider } from "@/features/ai/providers/tencent-ocr-provider";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  claimRunnableOcrJobs: vi.fn(),
  runOcrJobOnce: vi.fn(),
}));

vi.mock("@/features/ai/providers/tencent-ocr-provider", () => ({
  createTencentOcrProvider: vi.fn(() => ({ runGeneralBasicOcr: vi.fn() })),
  readTencentOcrConfigFromEnv: vi.fn(() => ({})),
}));

vi.mock("@/features/ai/ocr-image-source", () => ({
  resolveOcrImageInput: vi.fn(async () => ({ imageBase64: "AQID" })),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const envSnapshot = { ...process.env };
const supabase = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};

describe("/api/internal/ocr/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...envSnapshot,
      OCR_RUNNER_TOKEN: "runner-token",
      OCR_RUNNER_ORGANIZATION_ID: "org-runner",
      OCR_RUNNER_USER_ID: "user-runner",
      OCR_RUNNER_USER_NAME: "System OCR Runner",
      SUPABASE_PRIVATE_BUCKET: "evidence-private",
    };
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createTencentOcrProvider).mockReturnValue({
      runGeneralBasicOcr: vi.fn(),
    });
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([]);
  });

  it("rejects missing runner token without claiming or running jobs", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("rejects invalid runner token without claiming or running jobs", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("claims jobs with the configured system runner and returns safe metadata", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imagePath: "private/path.png",
        },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockResolvedValue({
      id: "job-1",
      organizationId: "org-runner",
      jobType: "ocr.extract_live_report",
      status: "succeeded",
      attempt: 1,
      maxAttempts: 3,
      payload: {
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imagePath: "private/path.png",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 20 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      failures: [],
      jobs: [{ id: "job-1", status: "succeeded", attempt: 1 }],
    });
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(claimRunnableOcrJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        client: supabase,
        organizationId: "org-runner",
        runnerId: "user-runner",
        limit: 10,
      }),
    );
    expect(runOcrJobOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        client: supabase,
        actor: {
          userId: "user-runner",
          name: "System OCR Runner",
          role: "ops_manager",
          organizationId: "org-runner",
        },
        jobId: "job-1",
        runnerId: "user-runner",
        imageResolver: expect.any(Function),
      }),
    );
  });

  it("sanitizes job failures and never leaks paths or secrets", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-fail",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-1",
          imagePath: "private/path.png",
        },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockRejectedValue(
      new Error("Provider failed for private/path.png with secret=abc123"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toEqual([]);
    expect(body.failures).toEqual([
      {
        jobId: "job-fail",
        errorCode: "runner_failed",
        errorMessage: "Provider failed for [redacted]",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });

  it("uses the storage resolver for OCR image input", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-1",
          imagePath: "private/path.png",
        },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockImplementation(async ({ imageResolver }) => {
      await imageResolver?.({
        liveReportId: "report-1",
        imagePath: "private/path.png",
      });
      return {
        id: "job-1",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "succeeded",
        attempt: 1,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-1",
          imagePath: "private/path.png",
        },
      } as Awaited<ReturnType<typeof runOcrJobOnce>>;
    });

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveOcrImageInput).toHaveBeenCalledWith({
      client: supabase,
      payload: {
        liveReportId: "report-1",
        imagePath: "private/path.png",
      },
      defaultBucket: "evidence-private",
    });
  });
});
