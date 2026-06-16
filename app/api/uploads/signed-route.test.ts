import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const createSignedUploadUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://upload.local/${path}`, token: "token-1" },
  error: null,
}));

const supabase = {
  storage: {
    from: vi.fn(() => ({ createSignedUploadUrl })),
  },
};

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/uploads/signed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/uploads/signed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/uploads/signed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
    } as never);
  });

  it("returns a signed private upload URL under the current organization path", async () => {
    const { POST } = await import("./signed/route");
    const response = await POST(
      jsonRequest({
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo video.mp4",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bucket: "evidence-private",
      path: "org-1/recordings/application-1/demo_video.mp4",
      signedUrl:
        "https://upload.local/org-1/recordings/application-1/demo_video.mp4",
      token: "token-1",
    });
    expect(supabase.storage.from).toHaveBeenCalledWith("evidence-private");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      "org-1/recordings/application-1/demo_video.mp4",
    );
  });

  it("rejects malformed JSON through the shared body validator", async () => {
    const { POST } = await import("./signed/route");
    const response = await POST(rawRequest("{not-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON request body",
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects upload categories outside the schema before building a path", async () => {
    const { POST } = await import("./signed/route");
    const response = await POST(
      jsonRequest({
        category: "reports/../../recordings",
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected storage errors", async () => {
    createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: new Error("database password leaked"),
    } as never);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { POST } = await import("./signed/route");
    const response = await POST(
      jsonRequest({
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unexpected error",
    });
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});
