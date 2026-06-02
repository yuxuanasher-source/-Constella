import type { AppRole } from "@/lib/rbac/roles";

export type AuditQueryClient = {
  from(table: "audit_logs"): {
    select(columns: string): AuditQueryBuilder;
  };
};

type AuditQueryBuilder = {
  eq(column: string, value: unknown): AuditQueryBuilder;
  in(column: string, values: unknown[]): AuditQueryBuilder;
  order(column: string, options: { ascending: boolean }): AuditQueryBuilder;
  limit(
    count: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

export type AuditCenterActor = {
  userId: string;
  role: AppRole;
  organizationId: string;
};

export type AuditCenterFilters = {
  module?: string;
  action?: string;
  projectId?: string;
  highRiskOnly?: boolean;
  limit?: number;
};

export type AuditCenterRow = {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: AppRole | null;
  action: string;
  module: string;
  object_type: string;
  object_id: string | null;
  object_name: string | null;
  project_id: string | null;
  streamer_id: string | null;
  changed_fields: string[];
  reason: string | null;
  is_high_risk: boolean;
  result: "success" | "failure";
  error_message: string | null;
  created_at: string;
};

export type AuditCenterEntry = {
  id: string;
  actorName: string | null;
  actorRole: AppRole | null;
  action: string;
  module: string;
  objectType: string;
  objectId: string | null;
  objectName: string | null;
  projectId: string | null;
  streamerId: string | null;
  changedFields: string[];
  reason: string | null;
  isHighRisk: boolean;
  result: "success" | "failure";
  errorMessage: string | null;
  createdAt: string;
};

const auditCenterSelect = `
  id,
  organization_id,
  actor_user_id,
  actor_name,
  actor_role,
  action,
  module,
  object_type,
  object_id,
  object_name,
  project_id,
  streamer_id,
  changed_fields,
  reason,
  is_high_risk,
  result,
  error_message,
  created_at
`;

const financeModules = ["finance", "settlement", "audit", "auth"];

export async function listAuditCenterEntries(
  client: AuditQueryClient,
  actor: AuditCenterActor,
  filters: AuditCenterFilters = {},
): Promise<AuditCenterEntry[]> {
  let query = client
    .from("audit_logs")
    .select(auditCenterSelect)
    .eq("organization_id", actor.organizationId);

  if (filters.module) {
    query = query.eq("module", filters.module);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
  }
  if (filters.highRiskOnly) {
    query = query.eq("is_high_risk", true);
  }

  if (actor.role === "finance") {
    query = query.in("module", financeModules);
  }
  if (actor.role === "operator_business") {
    if (filters.projectId) {
      query = query.eq("project_id", filters.projectId);
    } else {
      query = query.eq("actor_user_id", actor.userId);
    }
  } else if (filters.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(safeLimit(filters.limit));

  if (error) {
    throw error;
  }

  return ((data ?? []) as AuditCenterRow[]).map(toAuditCenterEntry);
}

export function toAuditCenterEntry(row: AuditCenterRow): AuditCenterEntry {
  return {
    id: row.id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    module: row.module,
    objectType: row.object_type,
    objectId: row.object_id,
    objectName: row.object_name,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    changedFields: row.changed_fields,
    reason: row.reason,
    isHighRisk: row.is_high_risk,
    result: row.result,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function safeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}
