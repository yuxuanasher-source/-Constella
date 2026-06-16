import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  confirmOcrJob,
  getOcrJob,
  markOcrJobNeedsReview,
  retryOcrJob,
} from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  confirmOcrJob: vi.fn(),
  getOcrJob: vi.fn(),
  markOcrJobNeedsReview: vi.fn(),
  retryOcrJob: vi.fn(),
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

describe("/api/ocr/jobs/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(),
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns one OCR job for MCN staff", async () => {
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 0,
      aiInvocationId: "invocation-1",
      payload: { liveReportId: "report-1" },
    });

    const response = await GET(
      new Request("http://localhost/api/ocr/jobs/job-1"),
      {
        params: Promise.resolve({ jobId: "job-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { id: "job-1", status: "queued" },
    });
  });

  it("allows streamers to view their own OCR job result", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "report-streamer", organization_id: "org-1" },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      userId: "user-streamer",
      role: "streamer",
    });
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-streamer",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "succeeded",
      attempt: 1,
      result: { extractedDuration: 238, extractedViewers: 11240 },
      payload: {
        liveReportId: "report-streamer",
        imagePath: "private/report.png",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/ocr/jobs/job-streamer"),
      {
        params: Promise.resolve({ jobId: "job-streamer" }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job).toMatchObject({
      id: "job-streamer",
      status: "succeeded",
      result: { extractedDuration: 238, extractedViewers: 11240 },
    });
    expect(JSON.stringify(body)).not.toContain("private/report.png");
  });

  it("retries a failed OCR job for MCN staff", async () => {
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "failed",
      attempt: 2,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      errorCode: "provider_failed",
      errorMessage: "Tencent OCR HTTP 500",
      payload: { liveReportId: "report-1" },
    });
    vi.mocked(retryOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 2,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      errorCode: "provider_failed",
      errorMessage: "Tencent OCR HTTP 500",
      payload: { liveReportId: "report-1" },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/job-1", {
        method: "POST",
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "job-1",
        status: "queued",
        attempt: 2,
        maxAttempts: 3,
        errorCode: "provider_failed",
      },
    });
  });

  it("confirms a needs-review OCR job for MCN staff without exposing raw OCR data", async () => {
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "needs_confirmation",
      attempt: 1,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      payload: {
        liveReportId: "report-1",
        imageBase64: "secret-image",
      },
      result: { extractedDuration: 70, extractedViewers: 280 },
    });
    vi.mocked(confirmOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "succeeded",
      attempt: 1,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      reviewedBy: "user-ops",
      reviewedAt: "2026-06-05T02:30:00.000Z",
      payload: {
        liveReportId: "report-1",
        imageBase64: "secret-image",
      },
      result: { extractedDuration: 70, extractedViewers: 280 },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/job-1", {
        method: "POST",
        body: JSON.stringify({
          action: "confirm",
          manualResult: { duration: 80, viewers: 320 },
        }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job).toMatchObject({
      id: "job-1",
      status: "succeeded",
      reviewedBy: "user-ops",
      reviewedAt: "2026-06-05T02:30:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("secret-image");
    expect(confirmOcrJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        jobId: "job-1",
        manualResult: { duration: 80, viewers: 320 },
      }),
    );
  });

  it("marks an OCR job as needs_review for operators", async () => {
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "failed",
      attempt: 3,
      maxAttempts: 3,
      payload: { liveReportId: "report-1" },
    });
    vi.mocked(markOcrJobNeedsReview).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "needs_review",
      attempt: 3,
      maxAttempts: 3,
      errorCode: "needs_review",
      errorMessage: "manual_review_requested",
      payload: { liveReportId: "report-1" },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/job-1", {
        method: "POST",
        body: JSON.stringify({ action: "needs_review" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "job-1",
        status: "needs_review",
        errorCode: "needs_review",
      },
    });
  });

  it("allows finance staff to view but not confirm OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "needs_review",
      attempt: 1,
      maxAttempts: 3,
      payload: { liveReportId: "report-1" },
    });

    const viewResponse = await GET(
      new Request("http://localhost/api/ocr/jobs/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(viewResponse.status).toBe(200);

    const confirmResponse = await POST(
      new Request("http://localhost/api/ocr/jobs/job-1", {
        method: "POST",
        body: JSON.stringify({ action: "confirm", manualResult: {} }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(confirmResponse.status).toBe(403);
    expect(confirmOcrJob).not.toHaveBeenCalled();
  });

  it("does not retry OCR jobs from another organization", async () => {
    vi.mocked(getOcrJob).mockResolvedValue({
      id: "job-cross",
      organizationId: "org-2",
      jobType: "ocr.extract_live_report",
      status: "failed",
      attempt: 1,
      maxAttempts: 3,
      payload: { liveReportId: "report-cross" },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/job-cross", {
        method: "POST",
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ jobId: "job-cross" }) },
    );

    expect(response.status).toBe(404);
    expect(retryOcrJob).not.toHaveBeenCalled();
  });

  it("returns 404 when a job does not exist", async () => {
    vi.mocked(getOcrJob).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/ocr/jobs/missing"),
      {
        params: Promise.resolve({ jobId: "missing" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("blocks streamers from retrying OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/job-1", {
        method: "POST",
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(403);
  });
});
