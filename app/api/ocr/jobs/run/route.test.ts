import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { createTencentOcrProvider } from "@/features/ai/providers/tencent-ocr-provider";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-image-source", () => ({
  resolveOcrImageInput: vi.fn(async () => ({ imageBase64: "AQID" })),
}));

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
  createSupabaseAdminClient: vi.fn(),
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

const supabase = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};
const admin = { rpc: vi.fn() };

describe("/api/ocr/jobs/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STORAGE_BUCKET_PRIVATE", "evidence-private");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createTencentOcrProvider).mockReturnValue({
      runGeneralBasicOcr: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
        client: admin,
        metricClient: admin,
        imageResolver: expect.any(Function),
      }),
    );
    const imageResolver =
      vi.mocked(runOcrJobOnce).mock.calls[0]?.[0].imageResolver;
    await expect(
      imageResolver?.({
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      }),
    ).resolves.toEqual({ imageBase64: "AQID" });
    expect(resolveOcrImageInput).toHaveBeenCalledWith({
      client: supabase,
      payload: {
        liveReportId: "report-1",
        screenshotId: "screenshot-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
      defaultBucket: "evidence-private",
    });
  });

  it("passes an unconfigured provider result through the shared manual run path", async () => {
    const job = {
      id: "job-unconfigured",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report" as const,
      status: "queued" as const,
      attempt: 0,
      maxAttempts: 3,
      payload: { liveReportId: "report-unconfigured", imageBase64: "AQID" },
    };
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([job]);
    const provider = {
      runGeneralBasicOcr: vi.fn(async () => ({
        status: "degraded" as const,
        textLines: [],
        textItems: [],
        confidence: 0,
        degradedReason: "provider_unconfigured",
      })),
    };
    vi.mocked(createTencentOcrProvider).mockReturnValueOnce(provider);
    vi.mocked(runOcrJobOnce).mockImplementationOnce(async (input) => {
      await input.provider.runGeneralBasicOcr({ imageBase64: "AQID" });
      return {
        ...job,
        status: "queued",
        attempt: 1,
        errorCode: "provider_unconfigured",
      };
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({ limit: 1 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{ id: "job-unconfigured", errorCode: "provider_unconfigured" }],
      failures: [],
    });
    expect(runOcrJobOnce).toHaveBeenCalledWith(
      expect.objectContaining({ provider }),
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

  it("uses the documented private storage bucket for OCR image resolution", async () => {
    vi.stubEnv("STORAGE_BUCKET_PRIVATE", "ocr-private");
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
        organizationId: "org-1",
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
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
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
      defaultBucket: "ocr-private",
    });
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
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
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
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("fails closed before claim or provider initialization when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "OCR execution service is unavailable",
    });
    expect(claimRunnableOcrJobs).not.toHaveBeenCalled();
    expect(createTencentOcrProvider).not.toHaveBeenCalled();
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });

  it("does not execute a claimed job outside the authenticated organization", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-cross-org",
        organizationId: "org-2",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        payload: { liveReportId: "report-cross-org" },
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [],
      failures: [
        {
          jobId: "job-cross-org",
          errorCode: "runner_failed",
          errorMessage: "OCR job organization mismatch",
        },
      ],
    });
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });
});
