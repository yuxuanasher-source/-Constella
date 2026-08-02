import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { OrganizationBrandServiceError } from "@/features/organizations/organization-brand-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("@/features/organizations/organization-brand-service", async (load) => {
  const actual =
    await load<
      typeof import("@/features/organizations/organization-brand-service")
    >();
  return {
    ...actual,
    OrganizationBrandService: vi.fn(function () {
      return { listContactCards: mocks.list, createContactCard: mocks.create };
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
const valid = {
  displayName: "Public Contact",
  title: "Operations",
  phone: "123456",
  email: null,
  wechat: null,
};
const request = (body: unknown) =>
  new Request("http://localhost/api/organization/contact-cards", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("/api/organization/contact-cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it.each(["GET", "POST"])(
    "returns 401 for unauthenticated %s",
    async (method) => {
      vi.mocked(getAuthContext).mockResolvedValue(null);
      const response =
        method === "GET" ? await GET() : await POST(request(valid));
      expect(response.status).toBe(401);
    },
  );

  it("allows a nonowner to list only the service-filtered safe cards", async () => {
    const member = { ...auth, role: "finance" as const };
    vi.mocked(getAuthContext).mockResolvedValue(member);
    mocks.list.mockResolvedValue([{ id: "card", status: "active" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contactCards: [{ id: "card", status: "active" }],
    });
    expect(mocks.list).toHaveBeenCalledWith(member);
  });

  it("returns 403 for nonowner creation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });
    mocks.create.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Forbidden",
        "ORGANIZATION_BRAND_FORBIDDEN",
        403,
      ),
    );
    expect((await POST(request(valid))).status).toBe(403);
  });

  it.each([
    { ...valid, phone: null },
    { ...valid, organizationId: auth.organizationId },
    { ...valid, email: "not-email" },
  ])("returns 400 for invalid or injected card body %#", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a validated organization-scoped card", async () => {
    const card = { id: "card", ...valid, status: "active" };
    mocks.create.mockResolvedValue(card);
    const response = await POST(request(valid));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ contactCard: card });
    expect(mocks.create).toHaveBeenCalledWith(auth, valid);
  });

  it("does not leak raw backend failures", async () => {
    mocks.list.mockRejectedValue(new Error("raw postgres password"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });
});
