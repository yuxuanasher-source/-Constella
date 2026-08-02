import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "./route";

import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
} from "@/features/organizations/organization-brand-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const mocks = vi.hoisted(() => ({
  getStudio: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@/features/organizations/organization-brand-service", async (load) => {
  const actual =
    await load<
      typeof import("@/features/organizations/organization-brand-service")
    >();
  return {
    ...actual,
    OrganizationBrandService: vi.fn(function () {
      return {
        getOrganizationBrandStudio: mocks.getStudio,
        saveBrandDraft: mocks.saveDraft,
      };
    }),
  };
});
vi.mock("@/features/organizations/organization-brand-repository", () => ({
  SupabaseOrganizationBrandRepository: vi.fn(function () {
    return { repository: "brand" };
  }),
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

const validDraft = {
  expectedVersion: 3,
  logoText: "DO",
  logoStoragePath: null,
  brandName: "Demo Brand",
  brandTagline: "Trusted operations",
  primaryColor: "#123456",
};

function patchRequest(body: unknown, raw = false) {
  return new Request("http://localhost/api/organization/brand", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

describe("/api/organization/brand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it.each(["GET", "PATCH"])(
    "returns 401 for unauthenticated %s",
    async (method) => {
      vi.mocked(getAuthContext).mockResolvedValue(null);
      const response =
        method === "GET" ? await GET() : await PATCH(patchRequest(validDraft));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    },
  );

  it("returns the safe studio DTO for an authenticated nonowner reader", async () => {
    const reader = { ...auth, role: "finance" as const };
    vi.mocked(getAuthContext).mockResolvedValue(reader);
    const studio = {
      organization: { id: auth.organizationId, name: auth.organizationName },
      published: { version: 3 },
      contactCards: [],
      permissions: { canManageBrand: false },
    };
    mocks.getStudio.mockResolvedValue(studio);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ studio });
    expect(mocks.getStudio).toHaveBeenCalledWith(reader);
  });

  it("returns 403 for a nonowner draft save", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });
    mocks.saveDraft.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Only organization owners can manage brand settings",
        "ORGANIZATION_BRAND_FORBIDDEN",
        403,
      ),
    );

    const response = await PATCH(patchRequest(validDraft));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only organization owners can manage brand settings",
      code: "ORGANIZATION_BRAND_FORBIDDEN",
    });
  });

  it.each([
    ["malformed JSON", patchRequest("{", true)],
    [
      "unknown actor injection",
      patchRequest({ ...validDraft, userId: "attacker" }),
    ],
    ["invalid color", patchRequest({ ...validDraft, primaryColor: "red" })],
  ])("returns 400 for %s", async (_label, request) => {
    const response = await PATCH(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORGANIZATION_BRAND_INVALID_INPUT",
    });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("saves a validated draft without accepting actor or organization ids", async () => {
    const draft = { baseVersion: 3, content: validDraft, persisted: true };
    mocks.saveDraft.mockResolvedValue(draft);

    const response = await PATCH(patchRequest(validDraft));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ draft });
    expect(mocks.saveDraft).toHaveBeenCalledWith(auth, validDraft);
  });

  it("preserves a safe conflict code and latest version", async () => {
    mocks.saveDraft.mockRejectedValue(
      new OrganizationBrandServiceError(
        "Organization brand version changed",
        "BRAND_VERSION_CONFLICT",
        409,
        4,
      ),
    );

    const response = await PATCH(patchRequest(validDraft));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Organization brand version changed",
      code: "BRAND_VERSION_CONFLICT",
      latestVersion: 4,
    });
  });

  it("maps unexpected database text to a safe 503", async () => {
    mocks.getStudio.mockRejectedValue(new Error("database password leaked"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Organization brand service is unavailable",
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
    });
    expect(OrganizationBrandService).toHaveBeenCalled();
  });
});
