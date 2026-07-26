import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

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

describe("delivery packages route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns 410 with the project admission share-board replacement", async () => {
    const response = await GET(
      new Request("http://localhost/api/delivery-packages?projectId=project-1"),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "Vendor delivery packages are retired",
      replacement: "/api/projects/project-1/admission-share-boards",
    });
  });

  it("requires projectId before returning the retired endpoint replacement", async () => {
    const response = await GET(
      new Request("http://localhost/api/delivery-packages"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "projectId is required" });
  });

  it("URL-encodes special characters in the replacement project segment", async () => {
    const projectId = "project/alpha beta?#";
    const response = await GET(
      new Request(
        `http://localhost/api/delivery-packages?projectId=${encodeURIComponent(projectId)}`,
      ),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Vendor delivery packages are retired",
      replacement:
        "/api/projects/project%2Falpha%20beta%3F%23/admission-share-boards",
    });
  });

  it("requires authentication before exposing the retirement response", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/api/delivery-packages?projectId=project-1"),
    );

    expect(response.status).toBe(401);
  });

  it("requires an MCN staff role before exposing the replacement", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await GET(
      new Request("http://localhost/api/delivery-packages?projectId=project-1"),
    );

    expect(response.status).toBe(403);
  });
});
