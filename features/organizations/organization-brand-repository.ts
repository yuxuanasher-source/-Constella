import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  OrganizationBrandDraftRecord,
  OrganizationBrandOrganizationRecord,
  OrganizationBrandRepository,
  OrganizationBrandSource,
  OrganizationBrandVersionRecord,
  OrganizationContactCardRecord,
  OrganizationContactCardStatus,
} from "./organization-brand-service";

type OrganizationRow = {
  id: string;
  name: string;
  branding: unknown;
  branding_version: number;
};

type DraftRow = {
  organization_id: string;
  base_version: number;
  content: unknown;
  updated_by?: string;
  updated_at: string;
};

type VersionRow = {
  organization_id: string;
  version: number;
  content: unknown;
  published_by?: string;
  published_at: string;
};

type ContactCardRow = {
  id: string;
  organization_id: string;
  display_name: string;
  title: string;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  status: OrganizationContactCardStatus;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

const draftSelect =
  "organization_id, base_version, content, updated_by, updated_at";
const versionSelect =
  "organization_id, version, content, published_by, published_at";
const contactCardSelect =
  "id, organization_id, display_name, title, phone, email, wechat, status, created_by, updated_by, created_at, updated_at";

export class SupabaseOrganizationBrandRepository implements OrganizationBrandRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getOrganization(
    organizationId: string,
  ): Promise<OrganizationBrandOrganizationRecord | null> {
    const { data, error } = await this.client
      .from("organizations")
      .select("id, name, branding, branding_version")
      .eq("id", organizationId)
      .maybeSingle<OrganizationRow>();
    throwIfError(error);
    return data
      ? {
          id: data.id,
          name: data.name,
          branding: data.branding,
          brandingVersion: data.branding_version,
        }
      : null;
  }

  async getDraft(
    organizationId: string,
  ): Promise<OrganizationBrandDraftRecord | null> {
    const { data, error } = await this.client
      .from("organization_brand_drafts")
      .select(draftSelect)
      .eq("organization_id", organizationId)
      .maybeSingle<DraftRow>();
    throwIfError(error);
    return data ? toDraftRecord(data) : null;
  }

  async listVersions(
    organizationId: string,
    limit: number,
  ): Promise<OrganizationBrandVersionRecord[]> {
    const { data, error } = await this.client
      .from("organization_brand_versions")
      .select(versionSelect)
      .eq("organization_id", organizationId)
      .order("published_at", { ascending: false })
      .limit(limit)
      .returns<VersionRow[]>();
    throwIfError(error);
    return (data ?? []).map(toVersionRecord);
  }

  async saveDraft(input: {
    organizationId: string;
    expectedVersion: number;
    content: OrganizationBrandSource;
  }): Promise<OrganizationBrandDraftRecord> {
    const { data, error } = await this.client
      .rpc("save_organization_brand_draft", {
        p_organization_id: input.organizationId,
        p_expected_version: input.expectedVersion,
        p_content: input.content,
      })
      .single<DraftRow>();
    throwIfError(error);
    return toDraftRecord(data);
  }

  async publishBrand(input: {
    organizationId: string;
    expectedVersion: number;
  }): Promise<OrganizationBrandVersionRecord> {
    const { data, error } = await this.client
      .rpc("publish_organization_brand", {
        p_organization_id: input.organizationId,
        p_expected_version: input.expectedVersion,
      })
      .single<VersionRow>();
    throwIfError(error);
    return toVersionRecord(data);
  }

  async listContactCards(
    organizationId: string,
  ): Promise<OrganizationContactCardRecord[]> {
    const { data, error } = await this.client
      .from("organization_contact_cards")
      .select(contactCardSelect)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .returns<ContactCardRow[]>();
    throwIfError(error);
    return (data ?? []).map(toContactCardRecord);
  }

  async getContactCard(
    organizationId: string,
    cardId: string,
  ): Promise<OrganizationContactCardRecord | null> {
    const { data, error } = await this.client
      .from("organization_contact_cards")
      .select(contactCardSelect)
      .eq("organization_id", organizationId)
      .eq("id", cardId)
      .maybeSingle<ContactCardRow>();
    throwIfError(error);
    return data ? toContactCardRecord(data) : null;
  }

  async createContactCard(input: {
    organizationId: string;
    actorUserId: string;
    displayName: string;
    title: string;
    phone: string | null;
    email: string | null;
    wechat: string | null;
    status: "active";
  }): Promise<OrganizationContactCardRecord> {
    const { data, error } = await this.client
      .from("organization_contact_cards")
      .insert({
        organization_id: input.organizationId,
        display_name: input.displayName,
        title: input.title,
        phone: input.phone,
        email: input.email,
        wechat: input.wechat,
        status: input.status,
        created_by: input.actorUserId,
        updated_by: input.actorUserId,
      })
      .select(contactCardSelect)
      .single<ContactCardRow>();
    throwIfError(error);
    return toContactCardRecord(data);
  }

  async updateContactCard(input: {
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
  }): Promise<OrganizationContactCardRecord | null> {
    const update = {
      ...(input.changes.displayName !== undefined
        ? { display_name: input.changes.displayName }
        : {}),
      ...(input.changes.title !== undefined
        ? { title: input.changes.title }
        : {}),
      ...(input.changes.phone !== undefined
        ? { phone: input.changes.phone }
        : {}),
      ...(input.changes.email !== undefined
        ? { email: input.changes.email }
        : {}),
      ...(input.changes.wechat !== undefined
        ? { wechat: input.changes.wechat }
        : {}),
      ...(input.changes.status !== undefined
        ? { status: input.changes.status }
        : {}),
      updated_by: input.actorUserId,
    };
    const { data, error } = await this.client
      .from("organization_contact_cards")
      .update(update)
      .eq("organization_id", input.organizationId)
      .eq("id", input.cardId)
      .select(contactCardSelect)
      .maybeSingle<ContactCardRow>();
    throwIfError(error);
    return data ? toContactCardRecord(data) : null;
  }

  async emergencyRemoveContactCard(input: {
    organizationId: string;
    cardId: string;
    reason: string;
  }): Promise<number> {
    const { data, error } = await this.client.rpc(
      "emergency_remove_contact_card_from_shares",
      {
        p_organization_id: input.organizationId,
        p_contact_card_id: input.cardId,
        p_reason: input.reason,
      },
    );
    throwIfError(error);
    if (typeof data !== "number" || !Number.isInteger(data) || data < 0) {
      throw new Error("Malformed emergency contact-card result");
    }
    return data;
  }
}

function toDraftRecord(row: DraftRow): OrganizationBrandDraftRecord {
  return {
    organizationId: row.organization_id,
    baseVersion: row.base_version,
    content: row.content,
    updatedAt: row.updated_at,
    ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
  };
}

function toVersionRecord(row: VersionRow): OrganizationBrandVersionRecord {
  return {
    organizationId: row.organization_id,
    version: row.version,
    content: row.content,
    publishedAt: row.published_at,
    ...(row.published_by ? { publishedBy: row.published_by } : {}),
  };
}

function toContactCardRecord(
  row: ContactCardRow,
): OrganizationContactCardRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    wechat: row.wechat,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function throwIfError(error: unknown): asserts error is null | undefined {
  if (error) {
    throw error;
  }
}
