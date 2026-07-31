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
  | "void"
  | "create_share_board"
  | "revoke_share_board"
  | "extend_share_board"
  | "reopen_share_board"
  | "rotate_share_board_token"
  | "create_knowledge_share"
  | "revoke_knowledge_share"
  | "resolve_share_playback_issue"
  | "vendor_review_submit"
  | "vendor_review_sync"
  | "enable_collaboration"
  | "disable_collaboration"
  | "create_collaboration_share"
  | "revoke_collaboration_share"
  | "submit_collaboration_application"
  | "review_collaboration_application"
  | "confirm_collaboration_counter"
  | "activate_collaboration_agreement";

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
