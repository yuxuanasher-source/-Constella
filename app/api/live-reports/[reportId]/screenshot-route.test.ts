import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

const createSignedUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://download.local/${path}` },
  error: null,
}));

const maybeSingle = vi.fn(async () => ({
  data: {
    storage_path: "org-1/report-screenshots/task-1/end.png",
    metadata: { imageBucket: "jy-private" },
    organization_id: "org-1",
  },
  error: null,
}));

const adminClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    })),
  })),
  storage: {
    from: vi.fn(() => ({ createSignedUrl })),
  },
};

function request() {
  return new Request("http://localhost/api/live-reports/report-1/screenshot");
}

function context(reportId = "report-1") {
  return { params: Promise.resolve({ reportId }) };
}

describe("GET /api/live-reports/[reportId]/screenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      name: "Ops",
      role: "ops_manager",
      organizationId: "org-1",
    } as never);
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "org-1/report-screenshots/task-1/end.png",
        metadata: { imageBucket: "jy-private" },
        organization_id: "org-1",
      },
      error: null,
    });
  });

  it("returns a signed download URL for the report's latest screenshot", async () => {
    const { GET } = await import("./screenshot/route");
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://download.local/org-1/report-screenshots/task-1/end.png",
    });
    expect(adminClient.storage.from).toHaveBeenCalledWith("jy-private");
  });

  it("rejects non-MCN staff", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "streamer-1",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
    } as never);

    const { GET } = await import("./screenshot/route");
    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(adminClient.storage.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the screenshot belongs to another organization", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        storage_path: "org-2/report-screenshots/task-9/end.png",
        metadata: {},
        organization_id: "org-2",
      },
      error: null,
    } as never);

    const { GET } = await import("./screenshot/route");
    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the report has no screenshot", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null } as never);

    const { GET } = await import("./screenshot/route");
    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });
});
