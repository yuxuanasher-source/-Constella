import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { runOcrWorkerIteration } from "@/features/ai/ocr-worker";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-worker", () => ({
  runOcrWorkerIteration: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};
const runnerOrganizationId = "11111111-1111-4111-8111-111111111111";
const runnerUserId = "22222222-2222-4222-8222-222222222222";

describe("/api/internal/ocr/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OCR_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("OCR_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("OCR_RUNNER_USER_ID", runnerUserId);
    vi.stubEnv("OCR_RUNNER_USER_NAME", "System OCR Runner");
    vi.stubEnv("STORAGE_BUCKET_PRIVATE", "evidence-private");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(runOcrWorkerIteration).mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      jobs: [],
      failures: [],
    });
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
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
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
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
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
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
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
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
  });

  it("requires a UUID-shaped runner organization", async () => {
    vi.stubEnv("OCR_RUNNER_ORGANIZATION_ID", "org-runner");

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "OCR runner organization and user are not configured",
    });
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
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
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
  });

  it("requires a UUID-shaped runner user", async () => {
    vi.stubEnv("OCR_RUNNER_USER_ID", "user-runner");

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "OCR runner organization and user are not configured",
    });
    expect(runOcrWorkerIteration).not.toHaveBeenCalled();
  });

  it("claims jobs with the configured system runner and returns safe metadata", async () => {
    vi.mocked(runOcrWorkerIteration).mockResolvedValue({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      jobs: [{ id: "job-1", status: "succeeded", attempt: 1 }],
      failures: [],
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
      summary: { claimed: 1, succeeded: 1, failed: 0 },
    });
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(runOcrWorkerIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        client: supabase,
        workerId: `ocr:http:${runnerUserId}`,
        limit: 10,
        leaseSeconds: 900,
      }),
    );
  });

  it("returns a safe failure when job claiming fails", async () => {
    vi.mocked(runOcrWorkerIteration).mockRejectedValue(
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
  });

  it("returns safe metadata when the provider is unconfigured", async () => {
    vi.mocked(runOcrWorkerIteration).mockResolvedValue({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      jobs: [],
      failures: [
        {
          jobId: "job-provider-missing",
          errorCode: "runner_failed",
          errorMessage: "[redacted]",
        },
      ],
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
      failures: [
        {
          jobId: "job-provider-missing",
          errorCode: "runner_failed",
          errorMessage: "[redacted]",
        },
      ],
      jobs: [],
      summary: { claimed: 1, succeeded: 0, failed: 1 },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("provider_unconfigured");
    expect(serialized).not.toContain("private/path.png");
    expect(serialized).not.toContain("Tencent OCR credentials");
  });

});
