import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { OrganizationBrandServiceError } from "@/features/organizations/organization-brand-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const emergencyRemove = vi.hoisted(() => vi.fn());
vi.mock("@/features/organizations/organization-brand-service", async (load) => {
  const actual =
    await load<
      typeof import("@/features/organizations/organization-brand-service")
    >();
  return {
    ...actual,
    OrganizationBrandService: vi.fn(function () {
      return { emergencyRemoveContactCard: emergencyRemove };
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

const CARD_ID = "44444444-4444-4444-8444-444444444444";
const auth = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Demo Organization",
};
const request = (body: unknown) =>
  new Request(
    `http://localhost/api/organization/contact-cards/${CARD_ID}/emergency-remove`,
    { method: "POST", body: JSON.stringify(body) },
  );
const context = (cardId = CARD_ID) => ({ params: Promise.resolve({ cardId }) });

describe("POST /api/organization/contact-cards/[cardId]/emergency-remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns 401 without auth", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);
    expect(
      (await POST(request({ reason: "compromised" }), context())).status,
    ).toBe(401);
  });

  it("returns a safe 503 when the server client is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    const response = await POST(request({ reason: "compromised" }), context());

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

    const response = await POST(request({ reason: "compromised" }), context());

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
    emergencyRemove.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Forbidden",
        "ORGANIZATION_BRAND_FORBIDDEN",
        403,
      ),
    );
    expect(
      (await POST(request({ reason: "compromised" }), context())).status,
    ).toBe(403);
  });

  it.each([
    ["bad-id", { reason: "compromised" }],
    [CARD_ID, { reason: "   " }],
    [CARD_ID, { reason: "x".repeat(501) }],
    [CARD_ID, { reason: "compromised", organizationId: auth.organizationId }],
  ])("returns 400 for invalid param/body %#", async (cardId, body) => {
    const response = await POST(request(body), context(cardId));
    expect(response.status).toBe(400);
    expect(emergencyRemove).not.toHaveBeenCalled();
  });

  it("returns the count from the atomic emergency RPC service", async () => {
    emergencyRemove.mockResolvedValue({ affectedActiveShareCount: 2 });
    const response = await POST(
      request({ reason: " compromised " }),
      context(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      affectedActiveShareCount: 2,
    });
    expect(emergencyRemove).toHaveBeenCalledWith(auth, CARD_ID, {
      reason: "compromised",
    });
  });

  it("maps missing cards and raw failures safely", async () => {
    emergencyRemove.mockRejectedValueOnce(
      new OrganizationBrandServiceError(
        "Contact card not found",
        "CONTACT_CARD_NOT_FOUND",
        404,
      ),
    );
    expect(
      (await POST(request({ reason: "compromised" }), context())).status,
    ).toBe(404);
    emergencyRemove.mockRejectedValueOnce(new Error("raw SQL secret"));
    const unavailable = await POST(
      request({ reason: "compromised" }),
      context(),
    );
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("raw SQL");
  });
});
