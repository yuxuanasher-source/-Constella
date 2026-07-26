import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { createOcrJob, listOcrJobs } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  createOcrJob: vi.fn(),
  listOcrJobs: vi.fn(),
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
const adminSupabase = { client: "admin-supabase" };

function createProjectScopedClient({
  report = { id: "report-1", project_id: "project-1" },
  project = { id: "project-1" },
}: {
  report?: { id: string; project_id: string } | null;
  project?: { id: string } | null;
} = {}) {
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: table === "live_reports" ? report : project,
          error: null,
        })),
      })),
    })),
  }));
  return { from };
}

describe("/api/ocr/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createProjectScopedClient() as never,
    );
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      adminSupabase as never,
    );
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
        client: adminSupabase,
        actor: auth,
        input: expect.objectContaining({
          liveReportId: "report-1",
          screenshotId: "screenshot-1",
          imageBase64: "ZmFrZQ==",
        }),
      }),
    );
  });

  it("returns 503 when the service-role enqueue client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({
          liveReportId: "report-1",
          imageBase64: "ZmFrZQ==",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase admin client is unavailable",
    });
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("does not elevate an operator without access to the report project", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "operator_business",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(
      createProjectScopedClient({ project: null }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs", {
        method: "POST",
        body: JSON.stringify({
          liveReportId: "report-1",
          imageBase64: "ZmFrZQ==",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Live report not found",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
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
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });
});
