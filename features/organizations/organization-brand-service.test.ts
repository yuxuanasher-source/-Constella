import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  type OrganizationBrandActor,
  type OrganizationBrandRepository,
} from "./organization-brand-service";
import { SupabaseOrganizationBrandRepository } from "./organization-brand-repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";
const LOGO_ID = "55555555-5555-4555-8555-555555555555";

const owner: OrganizationBrandActor = {
  userId: USER_ID,
  name: "Owner",
  role: "owner",
  organizationId: ORGANIZATION_ID,
  organizationName: "Demo Organization",
};

const member: OrganizationBrandActor = {
  ...owner,
  userId: "66666666-6666-4666-8666-666666666666",
  name: "Finance",
  role: "finance",
};

const publishedContent = {
  schemaVersion: 1,
  version: 3,
  logoText: "DO",
  logoStoragePath: `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp`,
  brandName: "Demo Brand",
  brandTagline: "Trusted operations",
  primaryColor: "#123456",
  actionColor: "#123A8C",
  softColor: "#E3E7EA",
  publishedAt: "2026-08-01T12:00:00.000Z",
  semantic: {
    success: "#00B42A",
    warning: "#FF7D00",
    danger: "#F53F3F",
    info: "#165DFF",
  },
  maliciousDatabaseField: "never expose",
};

const activeCard = {
  id: CARD_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Public Contact",
  title: "Operations",
  phone: "123456",
  email: null,
  wechat: null,
  status: "active" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  createdBy: USER_ID,
  updatedBy: USER_ID,
  rawSecret: "never expose",
};

const disabledCard = {
  ...activeCard,
  id: "77777777-7777-4777-8777-777777777777",
  displayName: "Disabled Contact",
  status: "disabled" as const,
};

function makeRepo(): OrganizationBrandRepository {
  return {
    getOrganization: vi.fn().mockResolvedValue({
      id: ORGANIZATION_ID,
      name: "Demo Organization",
      branding: publishedContent,
      brandingVersion: 3,
      internalBillingPlan: "secret",
    }),
    getDraft: vi.fn().mockResolvedValue(null),
    listVersions: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      baseVersion: 3,
      content: {
        logoText: "DO",
        logoStoragePath: null,
        brandName: "Demo Brand",
        brandTagline: "Trusted operations",
        primaryColor: "#123456",
      },
      updatedAt: "2026-08-02T00:00:00.000Z",
      updatedBy: USER_ID,
    }),
    publishBrand: vi.fn().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      version: 4,
      content: { ...publishedContent, version: 4 },
      publishedAt: "2026-08-02T00:00:00.000Z",
    }),
    listContactCards: vi.fn().mockResolvedValue([activeCard, disabledCard]),
    getContactCard: vi.fn().mockResolvedValue(activeCard),
    createContactCard: vi.fn().mockResolvedValue(activeCard),
    updateContactCard: vi.fn().mockResolvedValue(activeCard),
    emergencyRemoveContactCard: vi.fn().mockResolvedValue(2),
  };
}

const validDraft = {
  expectedVersion: 3,
  logoText: " DO ",
  logoStoragePath: null,
  brandName: " Demo Brand ",
  brandTagline: " Trusted operations ",
  primaryColor: "#a1b2c3",
};

describe("OrganizationBrandService", () => {
  const audit = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    audit.mockResolvedValue(undefined);
  });

  it("returns only canonical published data and active safe cards to nonowners", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    const studio = await service.getOrganizationBrandStudio(member);

    expect(studio).toEqual({
      organization: { id: ORGANIZATION_ID, name: "Demo Organization" },
      published: expect.objectContaining({
        schemaVersion: 1,
        version: 3,
        brandName: "Demo Brand",
      }),
      contactCards: [
        {
          id: CARD_ID,
          displayName: "Public Contact",
          title: "Operations",
          phone: "123456",
          email: null,
          wechat: null,
          status: "active",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      permissions: { canManageBrand: false },
    });
    expect(studio).not.toHaveProperty("draft");
    expect(studio).not.toHaveProperty("versions");
    expect(JSON.stringify(studio)).not.toContain("never expose");
    expect(repo.getDraft).not.toHaveBeenCalled();
    expect(repo.listVersions).not.toHaveBeenCalled();
  });

  it("synthesizes an unwritten owner draft from the current published brand", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    const studio = await service.getOrganizationBrandStudio(owner);

    expect(studio.draft).toEqual({
      baseVersion: 3,
      content: {
        logoText: "DO",
        logoStoragePath: `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp`,
        brandName: "Demo Brand",
        brandTagline: "Trusted operations",
        primaryColor: "#123456",
      },
      persisted: false,
      updatedAt: null,
    });
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  it("maps a persisted draft and immutable history through explicit DTOs", async () => {
    const repo = makeRepo();
    vi.mocked(repo.getDraft).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      baseVersion: 3,
      content: {
        logoText: "DB",
        logoStoragePath: null,
        brandName: "Draft Brand",
        brandTagline: "Draft tagline",
        primaryColor: "#ABCDEF",
        unknown: "hidden",
      },
      updatedAt: "2026-08-02T01:00:00.000Z",
      updatedBy: "private-user-id",
    });
    vi.mocked(repo.listVersions).mockResolvedValue([
      {
        organizationId: ORGANIZATION_ID,
        version: 3,
        content: publishedContent,
        publishedAt: "2026-08-01T12:00:00.000Z",
        publishedBy: "private-user-id",
      },
    ]);
    const service = new OrganizationBrandService(repo, audit);

    const studio = await service.getOrganizationBrandStudio(owner);

    expect(studio.draft).toEqual({
      baseVersion: 3,
      content: {
        logoText: "DB",
        logoStoragePath: null,
        brandName: "Draft Brand",
        brandTagline: "Draft tagline",
        primaryColor: "#ABCDEF",
      },
      persisted: true,
      updatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(studio.versions).toEqual([
      {
        version: 3,
        publishedAt: "2026-08-01T12:00:00.000Z",
        brand: expect.objectContaining({ version: 3, brandName: "Demo Brand" }),
      },
    ]);
    expect(JSON.stringify(studio)).not.toContain("private-user-id");
    expect(JSON.stringify(studio)).not.toContain("unknown");
  });

  it("maps malformed persisted draft data to a safe backend error", async () => {
    const repo = makeRepo();
    vi.mocked(repo.getDraft).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      baseVersion: 3,
      content: {
        logoText: "DB",
        logoStoragePath: null,
        brandName: { rawDatabaseSecret: "password" },
        brandTagline: "Draft tagline",
        primaryColor: "#ABCDEF",
      },
      updatedAt: "2026-08-02T01:00:00.000Z",
    });
    const service = new OrganizationBrandService(repo, audit);

    await expect(
      service.getOrganizationBrandStudio(owner),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
      status: 503,
      message: "Organization brand service is unavailable",
    });
  });

  it.each([
    [
      "save",
      (service: OrganizationBrandService) =>
        service.saveBrandDraft(member, validDraft),
    ],
    [
      "publish",
      (service: OrganizationBrandService) =>
        service.publishBrand(member, { expectedVersion: 3 }),
    ],
    [
      "create",
      (service: OrganizationBrandService) =>
        service.createContactCard(member, {
          displayName: "Contact",
          title: "",
          phone: "123",
          email: null,
          wechat: null,
        }),
    ],
    [
      "update",
      (service: OrganizationBrandService) =>
        service.updateContactCard(member, CARD_ID, { status: "disabled" }),
    ],
    [
      "emergency",
      (service: OrganizationBrandService) =>
        service.emergencyRemoveContactCard(member, CARD_ID, {
          reason: "compromised",
        }),
    ],
  ])("rejects nonowner %s mutations", async (_label, action) => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    await expect(action(service)).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_FORBIDDEN",
      status: 403,
    });
  });

  it.each([
    [{ ...validDraft, primaryColor: "red" }],
    [
      {
        ...validDraft,
        logoStoragePath: `${OTHER_ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp`,
      },
    ],
    [{ ...validDraft, injectedOrganizationId: OTHER_ORGANIZATION_ID }],
  ])("rejects invalid or unknown brand draft input", async (input) => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    await expect(service.saveBrandDraft(owner, input)).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_INVALID_INPUT",
      status: 400,
    });
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  it("normalizes draft source fields and returns a 409 with the latest version", async () => {
    const repo = makeRepo();
    vi.mocked(repo.saveDraft).mockRejectedValue({
      code: "40001",
      message: "brand_version_conflict database detail must stay private",
    });
    vi.mocked(repo.getOrganization).mockResolvedValue({
      id: ORGANIZATION_ID,
      name: "Demo Organization",
      branding: publishedContent,
      brandingVersion: 4,
    });
    const service = new OrganizationBrandService(repo, audit);

    await expect(service.saveBrandDraft(owner, validDraft)).rejects.toEqual(
      expect.objectContaining({
        code: "BRAND_VERSION_CONFLICT",
        status: 409,
        latestVersion: 4,
        message: "Organization brand version changed",
      }),
    );
    expect(repo.saveDraft).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      expectedVersion: 3,
      content: {
        logoText: "DO",
        logoStoragePath: null,
        brandName: "Demo Brand",
        brandTagline: "Trusted operations",
        primaryColor: "#A1B2C3",
      },
    });
  });

  it("returns only the persisted safe draft DTO after a successful atomic save", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    await expect(service.saveBrandDraft(owner, validDraft)).resolves.toEqual({
      baseVersion: 3,
      content: {
        logoText: "DO",
        logoStoragePath: null,
        brandName: "Demo Brand",
        brandTagline: "Trusted operations",
        primaryColor: "#123456",
      },
      persisted: true,
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("normalizes a successful publication into the canonical public DTO", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    const result = await service.publishBrand(owner, { expectedVersion: 3 });

    expect(result.version).toBe(4);
    expect(result.published).toMatchObject({
      schemaVersion: 1,
      version: 4,
      brandName: "Demo Brand",
      primaryColor: "#123456",
    });
    expect(JSON.stringify(result)).not.toContain("maliciousDatabaseField");
  });

  it.each([
    ["brand_draft_not_found raw SQL", "BRAND_DRAFT_NOT_FOUND", 404],
    [
      "brand_draft_invalid_color raw SQL",
      "ORGANIZATION_BRAND_INVALID_INPUT",
      400,
    ],
    ["insufficient_privilege raw SQL", "ORGANIZATION_BRAND_FORBIDDEN", 403],
    ["connection password leaked", "ORGANIZATION_BRAND_UNAVAILABLE", 503],
  ])(
    "maps publish repository failure safely: %s",
    async (message, code, status) => {
      const repo = makeRepo();
      vi.mocked(repo.publishBrand).mockRejectedValue({ message });
      const service = new OrganizationBrandService(repo, audit);

      const failure = await service
        .publishBrand(owner, { expectedVersion: 3 })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(OrganizationBrandServiceError);
      expect(failure).toMatchObject({ code, status });
      expect(JSON.stringify(failure)).not.toContain("raw SQL");
      expect(JSON.stringify(failure)).not.toContain("password leaked");
    },
  );

  it("normalizes contact creation and audits only safe before/after data", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    const result = await service.createContactCard(owner, {
      displayName: " Public Contact ",
      title: " Operations ",
      phone: " 123456 ",
      email: " ",
      wechat: null,
    });

    expect(repo.createContactCard).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      displayName: "Public Contact",
      title: "Operations",
      phone: "123456",
      email: null,
      wechat: null,
      status: "active",
    });
    expect(result).not.toHaveProperty("createdBy");
    expect(audit).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      actorName: "Owner",
      actorRole: "owner",
      action: "create",
      module: "organization_brand",
      objectType: "organization_contact_card",
      objectId: CARD_ID,
      objectName: "Public Contact",
      before: {},
      after: result,
      changedFields: [
        "displayName",
        "title",
        "phone",
        "email",
        "wechat",
        "status",
      ],
    });
  });

  it("rejects a cross-organization or missing contact card as not found", async () => {
    const repo = makeRepo();
    vi.mocked(repo.getContactCard).mockResolvedValue(null);
    const service = new OrganizationBrandService(repo, audit);

    await expect(
      service.updateContactCard(owner, CARD_ID, { status: "disabled" }),
    ).rejects.toMatchObject({ code: "CONTACT_CARD_NOT_FOUND", status: 404 });
    expect(repo.updateContactCard).not.toHaveBeenCalled();
  });

  it("disables a card without emergency share mutation and audits the status", async () => {
    const repo = makeRepo();
    vi.mocked(repo.updateContactCard).mockResolvedValue({
      ...activeCard,
      status: "disabled",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    const service = new OrganizationBrandService(repo, audit);

    const result = await service.updateContactCard(owner, CARD_ID, {
      status: "disabled",
    });

    expect(result.status).toBe("disabled");
    expect(repo.emergencyRemoveContactCard).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        before: expect.objectContaining({ status: "active" }),
        after: expect.objectContaining({ status: "disabled" }),
        changedFields: ["status"],
      }),
    );
  });

  it("audits the exact changed fields for a normal contact-card update", async () => {
    const repo = makeRepo();
    vi.mocked(repo.updateContactCard).mockResolvedValue({
      ...activeCard,
      displayName: "Updated Contact",
      title: "Partnerships",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    const service = new OrganizationBrandService(repo, audit);

    await service.updateContactCard(owner, CARD_ID, {
      displayName: " Updated Contact ",
      title: " Partnerships ",
    });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        before: expect.objectContaining({
          displayName: "Public Contact",
          title: "Operations",
        }),
        after: expect.objectContaining({
          displayName: "Updated Contact",
          title: "Partnerships",
        }),
        changedFields: ["displayName", "title"],
      }),
    );
  });

  it("keeps disabled cards owner-only when listing cards", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    await expect(service.listContactCards(member)).resolves.toHaveLength(1);
    await expect(service.listContactCards(owner)).resolves.toHaveLength(2);
  });

  it("requires a bounded emergency reason and returns the affected active-share count", async () => {
    const repo = makeRepo();
    const service = new OrganizationBrandService(repo, audit);

    await expect(
      service.emergencyRemoveContactCard(owner, CARD_ID, { reason: "   " }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_INVALID_INPUT",
      status: 400,
    });
    await expect(
      service.emergencyRemoveContactCard(owner, CARD_ID, {
        reason: "x".repeat(501),
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_INVALID_INPUT",
      status: 400,
    });

    await expect(
      service.emergencyRemoveContactCard(owner, CARD_ID, {
        reason: " compromised account ",
      }),
    ).resolves.toEqual({ affectedActiveShareCount: 2 });
    expect(repo.emergencyRemoveContactCard).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      cardId: CARD_ID,
      reason: "compromised account",
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("maps a malformed emergency RPC result to a safe unavailable error", async () => {
    const repo = makeRepo();
    vi.mocked(repo.emergencyRemoveContactCard).mockRejectedValue(
      new Error("Malformed emergency contact-card result: raw SQL password"),
    );
    const service = new OrganizationBrandService(repo, audit);

    await expect(
      service.emergencyRemoveContactCard(owner, CARD_ID, {
        reason: "compromised account",
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
      status: 503,
      message: "Organization brand service is unavailable",
    });
  });

  it("surfaces an explicit safe non-atomic audit failure after card DML", async () => {
    const repo = makeRepo();
    audit.mockRejectedValueOnce(new Error("audit database password leaked"));
    const service = new OrganizationBrandService(repo, audit);

    await expect(
      service.createContactCard(owner, {
        displayName: "Contact",
        title: "",
        phone: "123",
        email: null,
        wechat: null,
      }),
    ).rejects.toMatchObject({
      code: "CONTACT_CARD_AUDIT_FAILED",
      status: 503,
      message:
        "Contact card changed, but its audit record could not be written",
    });
  });
});

describe("SupabaseOrganizationBrandRepository", () => {
  it("saves drafts only through the atomic RPC and maps its stable result", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        organization_id: ORGANIZATION_ID,
        base_version: 3,
        content: {
          logoText: "DO",
          logoStoragePath: null,
          brandName: "Demo Brand",
          brandTagline: "Trusted operations",
          primaryColor: "#A1B2C3",
        },
        updated_at: "2026-08-02T00:00:00.000Z",
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ single });
    const from = vi.fn(() => {
      throw new Error("direct draft table DML must never be used");
    });
    const repo = new SupabaseOrganizationBrandRepository({
      rpc,
      from,
    } as never);

    await expect(
      repo.saveDraft({
        organizationId: ORGANIZATION_ID,
        expectedVersion: 3,
        content: {
          logoText: "DO",
          logoStoragePath: null,
          brandName: "Demo Brand",
          brandTagline: "Trusted operations",
          primaryColor: "#A1B2C3",
        },
      }),
    ).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      baseVersion: 3,
      content: expect.any(Object),
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("save_organization_brand_draft", {
      p_organization_id: ORGANIZATION_ID,
      p_expected_version: 3,
      p_content: expect.any(Object),
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses exact organization filters for card reads and writes", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: CARD_ID,
        organization_id: ORGANIZATION_ID,
        display_name: "Public Contact",
        title: "Operations",
        phone: "123456",
        email: null,
        wechat: null,
        status: "active",
        created_by: USER_ID,
        updated_by: USER_ID,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });
    const secondEq = vi.fn(() => ({ maybeSingle }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    const from = vi.fn(() => ({ select }));
    const repo = new SupabaseOrganizationBrandRepository({ from } as never);

    await repo.getContactCard(ORGANIZATION_ID, CARD_ID);

    expect(from).toHaveBeenCalledWith("organization_contact_cards");
    expect(firstEq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(secondEq).toHaveBeenCalledWith("id", CARD_ID);
  });

  it("publishes and emergency-removes only through their database RPCs", async () => {
    const rpc = vi
      .fn()
      .mockReturnValueOnce({
        single: vi.fn().mockResolvedValue({
          data: {
            organization_id: ORGANIZATION_ID,
            version: 4,
            content: { ...publishedContent, version: 4 },
            published_at: "2026-08-02T00:00:00.000Z",
          },
          error: null,
        }),
      })
      .mockResolvedValueOnce({ data: 2, error: null });
    const repo = new SupabaseOrganizationBrandRepository({ rpc } as never);

    await expect(
      repo.publishBrand({
        organizationId: ORGANIZATION_ID,
        expectedVersion: 3,
      }),
    ).resolves.toMatchObject({ version: 4 });
    await expect(
      repo.emergencyRemoveContactCard({
        organizationId: ORGANIZATION_ID,
        cardId: CARD_ID,
        reason: "compromised",
      }),
    ).resolves.toBe(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "publish_organization_brand", {
      p_organization_id: ORGANIZATION_ID,
      p_expected_version: 3,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "emergency_remove_contact_card_from_shares",
      {
        p_organization_id: ORGANIZATION_ID,
        p_contact_card_id: CARD_ID,
        p_reason: "compromised",
      },
    );
  });

  it.each([null, -1, 1.5, "2", {}, Number.NaN])(
    "rejects a malformed emergency RPC count: %p",
    async (data) => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      const repo = new SupabaseOrganizationBrandRepository({ rpc } as never);

      await expect(
        repo.emergencyRemoveContactCard({
          organizationId: ORGANIZATION_ID,
          cardId: CARD_ID,
          reason: "compromised",
        }),
      ).rejects.toThrow("Malformed emergency contact-card result");
    },
  );
});
