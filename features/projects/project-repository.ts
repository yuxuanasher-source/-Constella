import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectRecord, ProjectRepository } from "./project-service";

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status: ProjectRecord["status"];
  organization_id: string;
  starts_at: string | null;
  ends_at: string | null;
  open_signup: boolean;
  allow_direct_invite: boolean;
  force_recording: boolean;
  force_system_timing: boolean;
  vendor_name: string | null;
  product_name: string | null;
  agent_name: string | null;
  supplier_name: string | null;
  description: string | null;
  default_settlement_method: string;
  default_hourly_rate: number;
  default_base_salary: number;
  default_settlement_rule: unknown;
};

const projectSelect = `
  id,
  name,
  code,
  status,
  organization_id,
  starts_at,
  ends_at,
  open_signup,
  allow_direct_invite,
  force_recording,
  force_system_timing,
  vendor_name,
  product_name,
  agent_name,
  supplier_name,
  description,
  default_settlement_method,
  default_hourly_rate,
  default_base_salary,
  default_settlement_rule
`;

export class SupabaseProjectRepository implements ProjectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createDraft(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    code: string;
    supplierId?: string;
  }): Promise<ProjectRecord> {
    const { data, error } = await this.client
      .from("projects")
      .insert({
        organization_id: input.organizationId,
        created_by: input.actorUserId,
        name: input.name,
        code: input.code,
        supplier_id: input.supplierId,
        status: "draft",
      })
      .select(projectSelect)
      .single<ProjectRow>();

    if (error) {
      throw error;
    }

    return toProjectRecord(data);
  }

  async getById(projectId: string): Promise<ProjectRecord | null> {
    const { data, error } = await this.client
      .from("projects")
      .select(projectSelect)
      .eq("id", projectId)
      .maybeSingle<ProjectRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectRecord(data) : null;
  }

  async publish(projectId: string): Promise<ProjectRecord> {
    const { data, error } = await this.client
      .from("projects")
      .update({
        status: "recruiting",
        published_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .select(projectSelect)
      .single<ProjectRow>();

    if (error) {
      throw error;
    }

    return toProjectRecord(data);
  }

  async updateBasics(
    projectId: string,
    input: Partial<ProjectRecord>,
  ): Promise<ProjectRecord> {
    const { data, error } = await this.client
      .from("projects")
      .update(input)
      .eq("id", projectId)
      .select(projectSelect)
      .single<ProjectRow>();

    if (error) {
      throw error;
    }

    return toProjectRecord(data);
  }

  async updateSettlementRule(
    projectId: string,
    input: Partial<ProjectRecord>,
  ): Promise<ProjectRecord> {
    const { data, error } = await this.client
      .from("projects")
      .update(input)
      .eq("id", projectId)
      .select(projectSelect)
      .single<ProjectRow>();

    if (error) {
      throw error;
    }

    return toProjectRecord(data);
  }
}

function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    organization_id: row.organization_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    open_signup: row.open_signup,
    allow_direct_invite: row.allow_direct_invite,
    force_recording: row.force_recording,
    force_system_timing: row.force_system_timing,
    vendor_name: row.vendor_name,
    product_name: row.product_name,
    agent_name: row.agent_name,
    supplier_name: row.supplier_name,
    description: row.description,
    default_settlement_method: row.default_settlement_method,
    default_hourly_rate: row.default_hourly_rate,
    default_base_salary: row.default_base_salary,
    default_settlement_rule: row.default_settlement_rule,
  };
}
