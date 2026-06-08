import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const supabase = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};

describe("/api/internal/ocr/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OCR_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("OCR_RUNNER_ORGANIZATION_ID", "org-runner");
    vi.stubEnv("OCR_RUNNER_USER_ID", "user-runner");
    vi.stubEnv("OCR_RUNNER_USER_NAME", "System OCR Runner");
    vi.stubEnv("SUPABASE_PRIVATE_BUCKET", "evidence-private");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createTencentOcrProvider).mockReturnValue({
      runGeneralBasicOcr: vi.fn(),
    });
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("rejects a token without the bearer scheme", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("requires a configured runner organization", async () => {
    vi.stubEnv("OCR_RUNNER_ORGANIZATION_ID", "");

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("requires a configured runner user", async () => {
    vi.stubEnv("OCR_RUNNER_USER_ID", "");

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
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

  it("returns a safe failure when job claiming fails", async () => {
    vi.mocked(claimRunnableOcrJobs).mockRejectedValue(
      new Error("claim failed for private/path.png with secret=abc123"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      errorCode: "claim_failed",
      errorMessage: "OCR runner could not claim jobs",
    });
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
    expect(JSON.stringify(body)).not.toContain("claim failed");
    expect(runOcrJobOnce).not.toHaveBeenCalled();
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

  it("continues processing later OCR jobs when one job fails", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-fail",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: { liveReportId: "report-fail" },
      },
      {
        id: "job-ok",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: { liveReportId: "report-ok" },
      },
    ]);
    vi.mocked(runOcrJobOnce)
      .mockRejectedValueOnce(new Error("provider failed with secret=abc123"))
      .mockResolvedValueOnce({
        id: "job-ok",
        organizationId: "org-runner",
        jobType: "ocr.extract_live_report",
        status: "succeeded",
        attempt: 1,
        maxAttempts: 3,
        payload: { liveReportId: "report-ok" },
      });

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 2 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toEqual([
      { id: "job-ok", status: "succeeded", attempt: 1 },
    ]);
    expect(body.failures).toEqual([
      {
        jobId: "job-fail",
        errorCode: "runner_failed",
        errorMessage: "provider failed",
      },
    ]);
    expect(runOcrJobOnce).toHaveBeenCalledTimes(2);
  });

  it("returns safe metadata when the provider is unconfigured", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-provider-missing",
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
    vi.mocked(runOcrJobOnce).mockResolvedValue({
      id: "job-provider-missing",
      organizationId: "org-runner",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 1,
      maxAttempts: 3,
      errorCode: "provider_unconfigured",
      errorMessage: "Tencent OCR credentials are not configured",
      payload: {
        liveReportId: "report-1",
        imagePath: "private/path.png",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      failures: [],
      jobs: [{ id: "job-provider-missing", status: "queued", attempt: 1 }],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("provider_unconfigured");
    expect(serialized).not.toContain("private/path.png");
    expect(serialized).not.toContain("Tencent OCR credentials");
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
