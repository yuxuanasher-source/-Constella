import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectRecord, ProjectRepository } from "./project-service";

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status: ProjectRecord["status"];
  organization_id: string;
};

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
      .select("id, name, code, status, organization_id")
      .single<ProjectRow>();

    if (error) {
      throw error;
    }

    return toProjectRecord(data);
  }

  async getById(projectId: string): Promise<ProjectRecord | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, name, code, status, organization_id")
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
      .select("id, name, code, status, organization_id")
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
  };
}
