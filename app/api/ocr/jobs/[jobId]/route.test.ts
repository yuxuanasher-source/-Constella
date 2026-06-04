import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { getOcrJob, retryOcrJob } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  getOcrJob: vi.fn(),
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

    const response = await GET(new Request("http://localhost/api/ocr/jobs/job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { id: "job-1", status: "queued" },
    });
  });

  it("retries a failed OCR job for MCN staff", async () => {
    vi.mocked(retryOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 2,
      aiInvocationId: "invocation-1",
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
      job: { id: "job-1", status: "queued", attempt: 2 },
    });
  });

  it("returns 404 when a job does not exist", async () => {
    vi.mocked(getOcrJob).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/ocr/jobs/missing"), {
      params: Promise.resolve({ jobId: "missing" }),
    });

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
