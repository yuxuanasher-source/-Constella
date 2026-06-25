import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { createOcrJob, listOcrJobs } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  createOcrJob: vi.fn(),
  listOcrJobs: vi.fn(),
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

describe("/api/ocr/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(),
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("creates an OCR job for MCN staff", async () => {
    vi.mocked(createOcrJob).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "queued",
      attempt: 0,
      aiInvocationId: "invocation-1",
      payload: { liveReportId: "report-1", screenshotId: "screenshot-1" },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imageBase64: "ZmFrZQ==",
          expectedDuration: 80,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { id: "job-1", status: "queued", aiInvocationId: "invocation-1" },
    });
    expect(createOcrJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        input: expect.objectContaining({
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imageBase64: "ZmFrZQ==",
        }),
      }),
    );
  });

  it("lists OCR jobs for MCN staff", async () => {
    vi.mocked(listOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        aiInvocationId: "invocation-1",
        payload: { liveReportId: "report-1" },
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{ id: "job-1", status: "queued" }],
    });
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("blocks streamers from creating OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({ liveReportId: "report-1" }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("allows finance staff to list but not create OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });
    vi.mocked(listOcrJobs).mockResolvedValue([]);

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);

    const createResponse = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({
          liveReportId: "report-1",
          imageBase64: "ZmFrZQ==",
        }),
      }),
    );

    expect(createResponse.status).toBe(403);
    expect(createOcrJob).not.toHaveBeenCalled();
  });
});
