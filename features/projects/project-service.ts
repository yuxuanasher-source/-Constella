import { writeAuditLog, type AuditLogInput } from "@/lib/audit/audit";
import {
  canAssignProjectOwner,
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
  starts_at?: string | null;
  ends_at?: string | null;
  open_signup?: boolean;
  allow_direct_invite?: boolean;
  force_recording?: boolean;
  force_system_timing?: boolean;
  vendor_name?: string | null;
  product_name?: string | null;
  agent_name?: string | null;
  supplier_name?: string | null;
  description?: string | null;
  is_public_to_streamers?: boolean;
  public_summary?: string | null;
  game_download_url?: string | null;
  created_by?: string | null;
  owner_id?: string | null;
  ops_manager_id?: string | null;
  default_settlement_method?: string;
  default_hourly_rate?: number;
  default_base_salary?: number;
  default_settlement_rule?: unknown;
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

export type UpdateProjectBasicsInput = {
  name?: string;
  status?: ProjectStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  openSignup?: boolean;
  allowDirectInvite?: boolean;
  forceRecording?: boolean;
  forceSystemTiming?: boolean;
  vendorName?: string;
  productName?: string;
  agentName?: string;
  supplierName?: string;
  description?: string;
  isPublicToStreamers?: boolean;
  publicSummary?: string;
  gameDownloadUrl?: string | null;
  ownerId?: string | null;
};

export type UpdateProjectSettlementRuleInput = {
  defaultSettlementMethod?: string;
  defaultHourlyRate?: number;
  defaultBaseSalary?: number;
  defaultSettlementRule?: Record<string, unknown>;
};

export type ProjectRepository = {
  createDraft(input: {
    organizationId: string;
    actorUserId: string;
    ownerUserId: string;
    name: string;
    code: string;
    supplierId?: string;
  }): Promise<ProjectRecord>;
  getById(projectId: string): Promise<ProjectRecord | null>;
  publish(projectId: string): Promise<ProjectRecord>;
  updateBasics(
    projectId: string,
    input: Partial<ProjectRecord>,
  ): Promise<ProjectRecord>;
  updateSettlementRule(
    projectId: string,
    input: Partial<ProjectRecord>,
  ): Promise<ProjectRecord>;
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
    ownerUserId: actor.userId,
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

export async function updateProjectBasics({
  repo,
  audit,
  actor,
  projectId,
  input,
}: {
  repo: ProjectRepository;
  audit: ProjectAuditWriter;
  actor: ProjectActor;
  projectId: string;
  input: UpdateProjectBasicsInput;
}): Promise<ProjectRecord> {
  if (!canCreateProjectDraft(actor.role)) {
    throw new Error("Current role cannot update project basics");
  }
  if (input.ownerId !== undefined && !canAssignProjectOwner(actor.role)) {
    throw new Error("Only owner and ops_manager can assign project owners");
  }

  const before = await requireProject(repo, projectId);
  if (input.status) {
    assertProjectTransition(before.status, input.status);
  }
  const patch = mapBasicProjectPatch(input);
  const changedFields = Object.keys(patch);
  const project = await repo.updateBasics(projectId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "project",
    objectType: "project",
    objectId: project.id,
    objectName: project.name,
    before,
    after: project,
    changedFields,
    isHighRisk: false,
  });

  return project;
}

export async function updateProjectSettlementRule({
  repo,
  audit,
  actor,
  projectId,
  input,
  reason,
}: {
  repo: ProjectRepository;
  audit: ProjectAuditWriter;
  actor: ProjectActor;
  projectId: string;
  input: UpdateProjectSettlementRuleInput;
  reason: string;
}): Promise<ProjectRecord> {
  if (!canPublishProject(actor.role)) {
    throw new Error("Only owner and ops_manager can update settlement rules");
  }

  if (!reason.trim()) {
    throw new Error("Settlement rule changes require a reason");
  }

  const before = await requireProject(repo, projectId);
  const patch = mapSettlementProjectPatch(input);
  const changedFields = Object.keys(patch);
  const project = await repo.updateSettlementRule(projectId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "project",
    objectType: "project",
    objectId: project.id,
    objectName: project.name,
    before,
    after: project,
    changedFields,
    isHighRisk: true,
    reason: reason.trim(),
  });

  return project;
}

export function createProjectAuditWriter(
  client: Parameters<typeof writeAuditLog>[0],
) {
  return (input: AuditLogInput) => writeAuditLog(client, input);
}

async function requireProject(
  repo: Pick<ProjectRepository, "getById">,
  projectId: string,
): Promise<ProjectRecord> {
  const project = await repo.getById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

function mapBasicProjectPatch(
  input: UpdateProjectBasicsInput,
): Partial<ProjectRecord> {
  return removeUndefined({
    name: input.name,
    status: input.status,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    open_signup: input.openSignup,
    allow_direct_invite: input.allowDirectInvite,
    force_recording: input.forceRecording,
    force_system_timing: input.forceSystemTiming,
    vendor_name: input.vendorName,
    product_name: input.productName,
    agent_name: input.agentName,
    supplier_name: input.supplierName,
    description: input.description,
    is_public_to_streamers: input.isPublicToStreamers,
    public_summary: input.publicSummary,
    game_download_url: normalizeOptionalHttpUrl(input.gameDownloadUrl),
    owner_id: input.ownerId,
  });
}

function mapSettlementProjectPatch(
  input: UpdateProjectSettlementRuleInput,
): Partial<ProjectRecord> {
  return removeUndefined({
    default_settlement_method: input.defaultSettlementMethod,
    default_hourly_rate: input.defaultHourlyRate,
    default_base_salary: input.defaultBaseSalary,
    default_settlement_rule: input.defaultSettlementRule,
  });
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function normalizeOptionalHttpUrl(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Game download URL must be an http(s) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Game download URL must be an http(s) URL");
  }

  return trimmed;
}
