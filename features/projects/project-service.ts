import { writeAuditLog, type AuditLogInput } from "@/lib/audit/audit";
import {
  canCreateProjectDraft,
  canPublishProject,
} from "@/lib/rbac/permissions";
import type { AppRole } from "@/lib/rbac/roles";

import { assertProjectTransition, type ProjectStatus } from "./project-state";

export type ProjectRecord = {
  id: string;
  name: string;
  code?: string;
  status: ProjectStatus;
  organization_id?: string;
};

export type ProjectActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CreateProjectDraftInput = {
  name: string;
  code: string;
  supplierId?: string;
};

export type ProjectRepository = {
  createDraft(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    code: string;
    supplierId?: string;
  }): Promise<ProjectRecord>;
  getById(projectId: string): Promise<ProjectRecord | null>;
  publish(projectId: string): Promise<ProjectRecord>;
};

export type ProjectAuditWriter = (input: AuditLogInput) => Promise<void>;

export async function createProjectDraft({
  repo,
  audit,
  actor,
  input,
}: {
  repo: ProjectRepository;
  audit: ProjectAuditWriter;
  actor: ProjectActor;
  input: CreateProjectDraftInput;
}): Promise<ProjectRecord> {
  if (!canCreateProjectDraft(actor.role)) {
    throw new Error("Current role cannot create project drafts");
  }

  const project = await repo.createDraft({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    name: input.name,
    code: input.code,
    supplierId: input.supplierId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "project",
    objectType: "project",
    objectId: project.id,
    objectName: project.name,
    after: project,
    changedFields: ["name", "code", "status"],
  });

  return project;
}

export async function publishProject({
  repo,
  audit,
  actor,
  projectId,
}: {
  repo: ProjectRepository;
  audit: ProjectAuditWriter;
  actor: ProjectActor;
  projectId: string;
}): Promise<ProjectRecord> {
  if (!canPublishProject(actor.role)) {
    throw new Error("Only owner and ops_manager can publish projects");
  }

  const before = await repo.getById(projectId);
  if (!before) {
    throw new Error("Project not found");
  }

  assertProjectTransition(before.status, "recruiting");
  const project = await repo.publish(projectId);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "publish",
    module: "project",
    objectType: "project",
    objectId: project.id,
    objectName: project.name,
    before,
    after: project,
    changedFields: ["status", "published_at"],
  });

  return project;
}

export function createProjectAuditWriter(
  client: Parameters<typeof writeAuditLog>[0],
) {
  return (input: AuditLogInput) => writeAuditLog(client, input);
}
