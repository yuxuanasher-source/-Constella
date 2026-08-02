import { z } from "zod";

import {
  normalizePublishedBrand,
  type PublishedOrganizationBrand,
} from "./organization-brand";

import type { AuditLogInput } from "@/lib/audit/audit";
import { canManageOrganizationSettings } from "@/lib/rbac/permissions";
import type { AppRole } from "@/lib/rbac/roles";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
export const EMERGENCY_REASON_MAX_LENGTH = 500;

const uuidSchema = z.uuid();
const expectedVersionSchema = z.number().int().min(0).max(MAX_POSTGRES_INTEGER);

function boundedTrimmedString(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    });
}

const nullableContact = (max: number) =>
  z
    .union([boundedTrimmedString(0, max), z.null()])
    .transform((value) => value || null);

const nullableEmail = z
  .union([
    boundedTrimmedString(0, 120).refine(
      (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
    ),
    z.null(),
  ])
  .transform((value) => value || null);

export const organizationBrandSourceSchema = z.strictObject({
  logoText: boundedTrimmedString(1, 8),
  logoStoragePath: z.union([z.string().trim().min(1), z.null()]),
  brandName: boundedTrimmedString(1, 40),
  brandTagline: boundedTrimmedString(0, 80),
  primaryColor: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^#[0-9A-F]{6}$/u.test(value)),
});

export const organizationBrandDraftRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  logoText: organizationBrandSourceSchema.shape.logoText,
  logoStoragePath: organizationBrandSourceSchema.shape.logoStoragePath,
  brandName: organizationBrandSourceSchema.shape.brandName,
  brandTagline: organizationBrandSourceSchema.shape.brandTagline,
  primaryColor: organizationBrandSourceSchema.shape.primaryColor,
});

export const organizationBrandPublishRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
});

const contactCardSourceSchema = z
  .strictObject({
    displayName: boundedTrimmedString(1, 40),
    title: boundedTrimmedString(0, 40),
    phone: nullableContact(30),
    email: nullableEmail,
    wechat: nullableContact(60),
    status: z.enum(["active", "disabled"]),
  })
  .refine((value) => Boolean(value.phone || value.email || value.wechat));

export const createOrganizationContactCardRequestSchema = z
  .strictObject({
    displayName: boundedTrimmedString(1, 40),
    title: boundedTrimmedString(0, 40).default(""),
    phone: nullableContact(30).optional().default(null),
    email: nullableEmail.optional().default(null),
    wechat: nullableContact(60).optional().default(null),
  })
  .refine((value) => Boolean(value.phone || value.email || value.wechat));

export const updateOrganizationContactCardRequestSchema = z
  .strictObject({
    displayName: boundedTrimmedString(1, 40).optional(),
    title: boundedTrimmedString(0, 40).optional(),
    phone: nullableContact(30).optional(),
    email: nullableEmail.optional(),
    wechat: nullableContact(60).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const emergencyRemoveContactCardRequestSchema = z.strictObject({
  reason: boundedTrimmedString(1, EMERGENCY_REASON_MAX_LENGTH),
});

export type OrganizationBrandSource = z.infer<
  typeof organizationBrandSourceSchema
>;
export type OrganizationContactCardStatus = "active" | "disabled";

export type OrganizationBrandActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
  organizationName: string;
};

export type OrganizationBrandOrganizationRecord = {
  id: string;
  name: string;
  branding: unknown;
  brandingVersion: number;
  [key: string]: unknown;
};

export type OrganizationBrandDraftRecord = {
  organizationId: string;
  baseVersion: number;
  content: unknown;
  updatedAt: string;
  updatedBy?: string;
  [key: string]: unknown;
};

export type OrganizationBrandVersionRecord = {
  organizationId: string;
  version: number;
  content: unknown;
  publishedAt: string;
  publishedBy?: string;
  [key: string]: unknown;
};

export type OrganizationContactCardRecord = {
  id: string;
  organizationId: string;
  displayName: string;
  title: string;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  status: OrganizationContactCardStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  [key: string]: unknown;
};

export type OrganizationBrandRepository = {
  getOrganization(
    organizationId: string,
  ): Promise<OrganizationBrandOrganizationRecord | null>;
  getDraft(
    organizationId: string,
  ): Promise<OrganizationBrandDraftRecord | null>;
  listVersions(
    organizationId: string,
    limit: number,
  ): Promise<OrganizationBrandVersionRecord[]>;
  saveDraft(input: {
    organizationId: string;
    expectedVersion: number;
    content: OrganizationBrandSource;
  }): Promise<OrganizationBrandDraftRecord>;
  publishBrand(input: {
    organizationId: string;
    expectedVersion: number;
  }): Promise<OrganizationBrandVersionRecord>;
  listContactCards(
    organizationId: string,
  ): Promise<OrganizationContactCardRecord[]>;
  getContactCard(
    organizationId: string,
    cardId: string,
  ): Promise<OrganizationContactCardRecord | null>;
  createContactCard(input: {
    organizationId: string;
    actorUserId: string;
    displayName: string;
    title: string;
    phone: string | null;
    email: string | null;
    wechat: string | null;
    status: "active";
  }): Promise<OrganizationContactCardRecord>;
  updateContactCard(input: {
    organizationId: string;
    cardId: string;
    actorUserId: string;
    changes: Partial<{
      displayName: string;
      title: string;
      phone: string | null;
      email: string | null;
      wechat: string | null;
      status: OrganizationContactCardStatus;
    }>;
  }): Promise<OrganizationContactCardRecord | null>;
  emergencyRemoveContactCard(input: {
    organizationId: string;
    cardId: string;
    reason: string;
  }): Promise<number>;
};

export type OrganizationContactCardDto = {
  id: string;
  displayName: string;
  title: string;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  status: OrganizationContactCardStatus;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationBrandStudioDto = {
  organization: { id: string; name: string };
  published: PublishedOrganizationBrand;
  contactCards: OrganizationContactCardDto[];
  permissions: { canManageBrand: boolean };
  draft?: {
    baseVersion: number;
    content: OrganizationBrandSource;
    persisted: boolean;
    updatedAt: string | null;
  };
  versions?: Array<{
    version: number;
    publishedAt: string;
    brand: PublishedOrganizationBrand;
  }>;
};

export type OrganizationBrandAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export class OrganizationBrandServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly latestVersion?: number,
  ) {
    super(message);
    this.name = "OrganizationBrandServiceError";
  }
}

export class OrganizationBrandService {
  constructor(
    private readonly repo: OrganizationBrandRepository,
    private readonly audit: OrganizationBrandAuditWriter,
  ) {}

  async getOrganizationBrandStudio(
    actor: OrganizationBrandActor,
  ): Promise<OrganizationBrandStudioDto> {
    const canManageBrand = canManageOrganizationSettings(actor.role);
    let organization: OrganizationBrandOrganizationRecord | null;
    let cards: OrganizationContactCardRecord[];

    try {
      [organization, cards] = await Promise.all([
        this.repo.getOrganization(actor.organizationId),
        this.repo.listContactCards(actor.organizationId),
      ]);
    } catch (error) {
      throw mapRepositoryError(error);
    }

    if (!organization || organization.id !== actor.organizationId) {
      throw serviceError(
        "Organization not found",
        "ORGANIZATION_NOT_FOUND",
        404,
      );
    }

    const identity = {
      organizationId: organization.id,
      organizationName: organization.name,
    };
    const published = normalizeCurrentPublishedBrand(organization, identity);
    const studio: OrganizationBrandStudioDto = {
      organization: { id: organization.id, name: organization.name },
      published,
      contactCards: cards
        .filter(
          (card) =>
            card.organizationId === actor.organizationId &&
            (canManageBrand || card.status === "active"),
        )
        .map(toContactCardDto),
      permissions: { canManageBrand },
    };

    if (!canManageBrand) {
      return studio;
    }

    let draft: OrganizationBrandDraftRecord | null;
    let versions: OrganizationBrandVersionRecord[];
    try {
      [draft, versions] = await Promise.all([
        this.repo.getDraft(actor.organizationId),
        this.repo.listVersions(actor.organizationId, 10),
      ]);
    } catch (error) {
      throw mapRepositoryError(error);
    }

    studio.draft = draft
      ? {
          baseVersion: draft.baseVersion,
          content: sourceContentFromUnknown(draft.content),
          persisted: true,
          updatedAt: draft.updatedAt,
        }
      : {
          baseVersion: organization.brandingVersion,
          content: sourceFromPublished(published),
          persisted: false,
          updatedAt: null,
        };
    studio.versions = versions
      .filter((version) => version.organizationId === actor.organizationId)
      .map((version) => ({
        version: version.version,
        publishedAt: version.publishedAt,
        brand: normalizePublishedBrand(
          mergeRecord(version.content, {
            version: version.version,
            publishedAt: version.publishedAt,
          }),
          identity,
        ),
      }));

    return studio;
  }

  async saveBrandDraft(
    actor: OrganizationBrandActor,
    input: unknown,
  ): Promise<NonNullable<OrganizationBrandStudioDto["draft"]>> {
    assertOwner(actor);
    const parsed = parseInput(organizationBrandDraftRequestSchema, input);
    assertLogoPath(parsed.logoStoragePath, actor.organizationId);

    try {
      const saved = await this.repo.saveDraft({
        organizationId: actor.organizationId,
        expectedVersion: parsed.expectedVersion,
        content: {
          logoText: parsed.logoText,
          logoStoragePath: parsed.logoStoragePath,
          brandName: parsed.brandName,
          brandTagline: parsed.brandTagline,
          primaryColor: parsed.primaryColor,
        },
      });
      return {
        baseVersion: saved.baseVersion,
        content: sourceContentFromUnknown(saved.content),
        persisted: true,
        updatedAt: saved.updatedAt,
      };
    } catch (error) {
      if (databaseErrorText(error).includes("brand_version_conflict")) {
        let latestVersion: number | undefined;
        try {
          latestVersion = (
            await this.repo.getOrganization(actor.organizationId)
          )?.brandingVersion;
        } catch {
          latestVersion = undefined;
        }
        throw serviceError(
          "Organization brand version changed",
          "BRAND_VERSION_CONFLICT",
          409,
          latestVersion,
        );
      }
      throw mapRepositoryError(error);
    }
  }

  async publishBrand(
    actor: OrganizationBrandActor,
    input: unknown,
  ): Promise<{ version: number; published: PublishedOrganizationBrand }> {
    assertOwner(actor);
    const parsed = parseInput(organizationBrandPublishRequestSchema, input);

    try {
      const result = await this.repo.publishBrand({
        organizationId: actor.organizationId,
        expectedVersion: parsed.expectedVersion,
      });
      return {
        version: result.version,
        published: normalizePublishedBrand(
          mergeRecord(result.content, {
            version: result.version,
            publishedAt: result.publishedAt,
          }),
          {
            organizationId: actor.organizationId,
            organizationName: actor.organizationName,
          },
        ),
      };
    } catch (error) {
      if (databaseErrorText(error).includes("brand_version_conflict")) {
        let latestVersion: number | undefined;
        try {
          latestVersion = (
            await this.repo.getOrganization(actor.organizationId)
          )?.brandingVersion;
        } catch {
          latestVersion = undefined;
        }
        throw serviceError(
          "Organization brand version changed",
          "BRAND_VERSION_CONFLICT",
          409,
          latestVersion,
        );
      }
      throw mapRepositoryError(error);
    }
  }

  async listContactCards(
    actor: OrganizationBrandActor,
  ): Promise<OrganizationContactCardDto[]> {
    try {
      const cards = await this.repo.listContactCards(actor.organizationId);
      return cards
        .filter(
          (card) =>
            card.organizationId === actor.organizationId &&
            (canManageOrganizationSettings(actor.role) ||
              card.status === "active"),
        )
        .map(toContactCardDto);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async createContactCard(
    actor: OrganizationBrandActor,
    input: unknown,
  ): Promise<OrganizationContactCardDto> {
    assertOwner(actor);
    const parsed = parseInput(
      createOrganizationContactCardRequestSchema,
      input,
    );
    const normalized = parseInput(contactCardSourceSchema, {
      ...parsed,
      status: "active",
    });

    let created: OrganizationContactCardRecord;
    try {
      created = await this.repo.createContactCard({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        ...normalized,
        status: "active",
      });
    } catch (error) {
      throw mapRepositoryError(error);
    }
    assertCardOrganization(created, actor.organizationId);
    const dto = toContactCardDto(created);

    await this.writeCardAudit({
      actor,
      action: "create",
      card: dto,
      before: {},
      after: cardAuditSnapshot(dto),
      changedFields: [
        "displayName",
        "title",
        "phone",
        "email",
        "wechat",
        "status",
      ],
    });
    return dto;
  }

  async updateContactCard(
    actor: OrganizationBrandActor,
    cardId: string,
    input: unknown,
  ): Promise<OrganizationContactCardDto> {
    assertOwner(actor);
    assertCardId(cardId);
    const changes = parseInput(
      updateOrganizationContactCardRequestSchema,
      input,
    );

    let before: OrganizationContactCardRecord | null;
    try {
      before = await this.repo.getContactCard(actor.organizationId, cardId);
    } catch (error) {
      throw mapRepositoryError(error);
    }
    if (!before || before.organizationId !== actor.organizationId) {
      throw serviceError(
        "Contact card not found",
        "CONTACT_CARD_NOT_FOUND",
        404,
      );
    }

    const normalized = parseInput(contactCardSourceSchema, {
      displayName: changes.displayName ?? before.displayName,
      title: changes.title ?? before.title,
      phone: changes.phone === undefined ? before.phone : changes.phone,
      email: changes.email === undefined ? before.email : changes.email,
      wechat: changes.wechat === undefined ? before.wechat : changes.wechat,
      status: changes.status ?? before.status,
    });
    const changedFields = (
      ["displayName", "title", "phone", "email", "wechat", "status"] as const
    ).filter((field) => before?.[field] !== normalized[field]);
    if (changedFields.length === 0) {
      return toContactCardDto(before);
    }

    let updated: OrganizationContactCardRecord | null;
    try {
      updated = await this.repo.updateContactCard({
        organizationId: actor.organizationId,
        cardId,
        actorUserId: actor.userId,
        changes: Object.fromEntries(
          changedFields.map((field) => [field, normalized[field]]),
        ),
      });
    } catch (error) {
      throw mapRepositoryError(error);
    }
    if (!updated || updated.organizationId !== actor.organizationId) {
      throw serviceError(
        "Contact card not found",
        "CONTACT_CARD_NOT_FOUND",
        404,
      );
    }
    const beforeDto = toContactCardDto(before);
    const afterDto = toContactCardDto(updated);
    await this.writeCardAudit({
      actor,
      action: "update",
      card: afterDto,
      before: cardAuditSnapshot(beforeDto),
      after: cardAuditSnapshot(afterDto),
      changedFields: [...changedFields],
    });
    return afterDto;
  }

  async emergencyRemoveContactCard(
    actor: OrganizationBrandActor,
    cardId: string,
    input: unknown,
  ): Promise<{ affectedActiveShareCount: number }> {
    assertOwner(actor);
    assertCardId(cardId);
    const parsed = parseInput(emergencyRemoveContactCardRequestSchema, input);

    try {
      const affectedActiveShareCount =
        await this.repo.emergencyRemoveContactCard({
          organizationId: actor.organizationId,
          cardId,
          reason: parsed.reason,
        });
      return { affectedActiveShareCount };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  private async writeCardAudit(input: {
    actor: OrganizationBrandActor;
    action: "create" | "update";
    card: OrganizationContactCardDto;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedFields: string[];
  }): Promise<void> {
    try {
      await this.audit({
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.userId,
        actorName: input.actor.name,
        actorRole: input.actor.role,
        action: input.action,
        module: "organization_brand",
        objectType: "organization_contact_card",
        objectId: input.card.id,
        objectName: input.card.displayName,
        before: input.before,
        after: input.after,
        changedFields: input.changedFields,
      });
    } catch {
      throw serviceError(
        "Contact card changed, but its audit record could not be written",
        "CONTACT_CARD_AUDIT_FAILED",
        503,
      );
    }
  }
}

function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw serviceError(
      "Invalid organization brand request",
      "ORGANIZATION_BRAND_INVALID_INPUT",
      400,
    );
  }
  return result.data;
}

function assertOwner(actor: OrganizationBrandActor): void {
  if (!canManageOrganizationSettings(actor.role)) {
    throw serviceError(
      "Only organization owners can manage brand settings",
      "ORGANIZATION_BRAND_FORBIDDEN",
      403,
    );
  }
}

function assertLogoPath(path: string | null, organizationId: string): void {
  if (path === null) {
    return;
  }
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  if (
    !new RegExp(`^${organizationId}/brand-logos/${uuid}\\.webp$`, "i").test(
      path,
    )
  ) {
    throw serviceError(
      "Invalid organization brand request",
      "ORGANIZATION_BRAND_INVALID_INPUT",
      400,
    );
  }
}

function assertCardId(cardId: string): void {
  if (!uuidSchema.safeParse(cardId).success) {
    throw serviceError(
      "Invalid contact card id",
      "ORGANIZATION_BRAND_INVALID_INPUT",
      400,
    );
  }
}

function assertCardOrganization(
  card: OrganizationContactCardRecord,
  organizationId: string,
): void {
  if (card.organizationId !== organizationId) {
    throw serviceError(
      "Organization brand service is unavailable",
      "ORGANIZATION_BRAND_UNAVAILABLE",
      503,
    );
  }
}

function normalizeCurrentPublishedBrand(
  organization: OrganizationBrandOrganizationRecord,
  identity: { organizationId: string; organizationName: string },
): PublishedOrganizationBrand {
  return normalizePublishedBrand(
    mergeRecord(organization.branding, {
      version: organization.brandingVersion,
    }),
    identity,
  );
}

function sourceFromPublished(
  published: PublishedOrganizationBrand,
): OrganizationBrandSource {
  return {
    logoText: published.logoText,
    logoStoragePath: published.logoStoragePath,
    brandName: published.brandName,
    brandTagline: published.brandTagline,
    primaryColor: published.primaryColor,
  };
}

function sourceContentFromUnknown(value: unknown): OrganizationBrandSource {
  const record = recordFrom(value);
  const result = organizationBrandSourceSchema.safeParse({
    logoText: record.logoText,
    logoStoragePath: record.logoStoragePath,
    brandName: record.brandName,
    brandTagline: record.brandTagline,
    primaryColor: record.primaryColor,
  });
  if (!result.success) {
    throw serviceError(
      "Organization brand service is unavailable",
      "ORGANIZATION_BRAND_UNAVAILABLE",
      503,
    );
  }
  return result.data;
}

function toContactCardDto(
  card: OrganizationContactCardRecord,
): OrganizationContactCardDto {
  return {
    id: card.id,
    displayName: card.displayName,
    title: card.title,
    phone: card.phone,
    email: card.email,
    wechat: card.wechat,
    status: card.status,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

function cardAuditSnapshot(
  card: OrganizationContactCardDto,
): Record<string, unknown> {
  return {
    id: card.id,
    displayName: card.displayName,
    title: card.title,
    phone: card.phone,
    email: card.email,
    wechat: card.wechat,
    status: card.status,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

function mergeRecord(
  value: unknown,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...recordFrom(value), ...overrides };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function databaseErrorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return `${typeof candidate.code === "string" ? candidate.code : ""} ${
    typeof candidate.message === "string" ? candidate.message : ""
  }`.toLowerCase();
}

function mapRepositoryError(error: unknown): OrganizationBrandServiceError {
  if (error instanceof OrganizationBrandServiceError) {
    return error;
  }
  const text = databaseErrorText(error);
  if (text.includes("brand_draft_not_found")) {
    return serviceError("Brand draft not found", "BRAND_DRAFT_NOT_FOUND", 404);
  }
  if (
    text.includes("brand_draft_invalid") ||
    text.includes("brand_draft_unknown_field")
  ) {
    return serviceError(
      "Invalid organization brand request",
      "ORGANIZATION_BRAND_INVALID_INPUT",
      400,
    );
  }
  if (text.includes("contact_card_not_found")) {
    return serviceError(
      "Contact card not found",
      "CONTACT_CARD_NOT_FOUND",
      404,
    );
  }
  if (text.includes("insufficient_privilege") || text.includes("42501")) {
    return serviceError(
      "Only organization owners can manage brand settings",
      "ORGANIZATION_BRAND_FORBIDDEN",
      403,
    );
  }
  return serviceError(
    "Organization brand service is unavailable",
    "ORGANIZATION_BRAND_UNAVAILABLE",
    503,
  );
}

function serviceError(
  message: string,
  code: string,
  status: number,
  latestVersion?: number,
): OrganizationBrandServiceError {
  return new OrganizationBrandServiceError(
    message,
    code,
    status,
    latestVersion,
  );
}
