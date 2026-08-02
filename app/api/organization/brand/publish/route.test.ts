import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { OrganizationBrandServiceError } from "@/features/organizations/organization-brand-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const publish = vi.hoisted(() => vi.fn());
vi.mock("@/features/organizations/organization-brand-service", async (load) => {
  const actual =
    await load<
      typeof import("@/features/organizations/organization-brand-service")
    >();
  return {
    ...actual,
    OrganizationBrandService: vi.fn(function () {
      return { publishBrand: publish };
    }),
  };
});
vi.mock("@/features/organizations/organization-brand-repository", () => ({
  SupabaseOrganizationBrandRepository: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/audit/audit", () => ({ writeAuditLog: vi.fn() }));

const auth = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Demo Organization",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/organization/brand/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/organization/brand/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns 401 without auth", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);
    expect((await POST(request({ expectedVersion: 3 }))).status).toBe(401);
  });

  it("returns a safe 503 when the server client is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    const response = await POST(request({ expectedVersion: 3 }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Organization brand service is unavailable",
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
    });
    expect(getAuthContext).not.toHaveBeenCalled();
  });

  it("returns a safe 503 when auth bootstrap rejects", async () => {
    vi.mocked(getAuthContext).mockRejectedValue(
      new Error("raw membership database password"),
    );

    const response = await POST(request({ expectedVersion: 3 }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Organization brand service is unavailable",
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("returns 403 for nonowners", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "ops_manager",
    });
    publish.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Forbidden",
        "ORGANIZATION_BRAND_FORBIDDEN",
        403,
      ),
    );
    expect((await POST(request({ expectedVersion: 3 }))).status).toBe(403);
  });

  it.each([
    { expectedVersion: -1 },
    { expectedVersion: 3, organizationId: auth.organizationId },
  ])("rejects invalid or injected body %#", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes through the service and returns the canonical result", async () => {
    const result = { version: 4, published: { version: 4, brandName: "Demo" } };
    publish.mockResolvedValue(result);
    const response = await POST(request({ expectedVersion: 3 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(publish).toHaveBeenCalledWith(auth, { expectedVersion: 3 });
  });

  it("returns safe version conflicts and backend failures", async () => {
    publish.mockRejectedValueOnce(
      new OrganizationBrandServiceError(
        "Version changed",
        "BRAND_VERSION_CONFLICT",
        409,
        4,
      ),
    );
    const conflict = await POST(request({ expectedVersion: 3 }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ latestVersion: 4 });

    publish.mockRejectedValueOnce(new Error("raw SQL secret"));
    const unavailable = await POST(request({ expectedVersion: 3 }));
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("raw SQL");
  });
});
