import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";

import { OrganizationBrandServiceError } from "@/features/organizations/organization-brand-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/features/organizations/organization-brand-service", async (load) => {
  const actual =
    await load<
      typeof import("@/features/organizations/organization-brand-service")
    >();
  return {
    ...actual,
    OrganizationBrandService: vi.fn(function () {
      return { updateContactCard: update };
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
  new Request(`http://localhost/api/organization/contact-cards/${CARD_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const context = (cardId = CARD_ID) => ({ params: Promise.resolve({ cardId }) });

describe("PATCH /api/organization/contact-cards/[cardId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns 401 without auth", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);
    expect(
      (await PATCH(request({ status: "disabled" }), context())).status,
    ).toBe(401);
  });

  it("returns a safe 503 when the server client is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    const response = await PATCH(request({ status: "disabled" }), context());

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

    const response = await PATCH(request({ status: "disabled" }), context());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Organization brand service is unavailable",
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("returns 403 for a nonowner", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });
    update.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Forbidden",
        "ORGANIZATION_BRAND_FORBIDDEN",
        403,
      ),
    );
    expect(
      (await PATCH(request({ status: "disabled" }), context())).status,
    ).toBe(403);
  });

  it.each([
    ["bad id", { status: "disabled" }],
    [CARD_ID, { status: "deleted" }],
    [CARD_ID, { status: "disabled", userId: "attacker" }],
  ])("returns 400 for invalid param/body %#", async (cardId, body) => {
    const response = await PATCH(request(body), context(cardId));
    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the exact route card through the service", async () => {
    const card = { id: CARD_ID, status: "disabled" };
    update.mockResolvedValue(card);
    const response = await PATCH(request({ status: "disabled" }), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ contactCard: card });
    expect(update).toHaveBeenCalledWith(auth, CARD_ID, { status: "disabled" });
  });

  it("maps cross-org not-found and unexpected errors safely", async () => {
    update.mockRejectedValueOnce(
      new OrganizationBrandServiceError(
        "Contact card not found",
        "CONTACT_CARD_NOT_FOUND",
        404,
      ),
    );
    expect(
      (await PATCH(request({ status: "disabled" }), context())).status,
    ).toBe(404);
    update.mockRejectedValueOnce(new Error("raw SQL password"));
    const unavailable = await PATCH(request({ status: "disabled" }), context());
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("password");
  });
});
