import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listVendorDeliveryPackage } from "@/features/delivery-packages/delivery-package-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/delivery-packages/delivery-package-dto", () => ({
  listVendorDeliveryPackage: vi.fn(),
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

describe("delivery packages route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(listVendorDeliveryPackage).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "王者荣耀暑期冲榜",
        streamerName: "阿洛",
        settlementDurationMinutes: 120,
        evidenceLevel: "system",
        screenshotCount: 2,
      },
    ]);
  });

  it("returns vendor-safe delivery package by project id", async () => {
    const response = await GET(
      new Request("http://localhost/api/delivery-packages?projectId=project-1"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      items: [
        {
          projectId: "project-1",
          projectName: "王者荣耀暑期冲榜",
          streamerName: "阿洛",
          settlementDurationMinutes: 120,
          evidenceLevel: "system",
          screenshotCount: 2,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("grossMarginCents");
    expect(listVendorDeliveryPackage).toHaveBeenCalledWith(
      { client: "supabase" },
      {
        organizationId: "org-1",
        role: "ops_manager",
        userId: "user-ops",
      },
      "project-1",
    );
  });

  it("requires projectId", async () => {
    const response = await GET(
      new Request("http://localhost/api/delivery-packages"),
    );

    expect(response.status).toBe(400);
    expect(listVendorDeliveryPackage).not.toHaveBeenCalled();
  });
});
