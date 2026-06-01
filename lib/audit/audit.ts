import type { AppRole } from "@/lib/rbac/roles";

export type AuditAction =
  | "create"
  | "update"
  | "approve"
  | "reject"
  | "export"
  | "lock"
  | "reopen"
  | "login"
  | "logout"
  | "publish"
  | "void";

type AuditInsertClient = {
  from(table: "audit_logs"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type AuditLogInput = {
  organizationId: string;
  actorUserId?: string;
  actorName?: string;
  actorRole?: AppRole;
  action: AuditAction;
  module: string;
  objectType: string;
  objectId?: string;
  objectName?: string;
  projectId?: string;
  streamerId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  isHighRisk?: boolean;
  result?: "success" | "failure";
  errorMessage?: string;
};

export async function writeAuditLog(
  client: AuditInsertClient,
  input: AuditLogInput,
): Promise<void> {
  if (input.isHighRisk && !input.reason?.trim()) {
    throw new Error("High-risk audit logs require a reason");
  }

  const { error } = await client.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_user_id: input.actorUserId,
    actor_name: input.actorName,
    actor_role: input.actorRole,
    action: input.action,
    module: input.module,
    object_type: input.objectType,
    object_id: input.objectId,
    object_name: input.objectName,
    project_id: input.projectId,
    streamer_id: input.streamerId,
    before_json: input.before ?? {},
    after_json: input.after ?? {},
    changed_fields: input.changedFields ?? [],
    reason: input.reason,
    is_high_risk: input.isHighRisk ?? false,
    result: input.result ?? "success",
    error_message: input.errorMessage,
  });

  if (error) {
    throw error;
  }
}
