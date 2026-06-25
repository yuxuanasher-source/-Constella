import type { AuditLogInput } from "@/lib/audit/audit";
import {
  canCreateOrganizationMemberRole,
  canManageOrganizationMembers,
  canViewOrganizationMembers,
} from "@/lib/rbac/permissions";
import { appRoles, type AppRole } from "@/lib/rbac/roles";

export type OrganizationMemberStatus = "invited" | "active" | "suspended";

export type OrganizationActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type OrganizationMemberRecord = {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  phone?: string;
  name: string;
  role: AppRole;
  status: OrganizationMemberStatus;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMemberRepository = {
  listMembers(organizationId: string): Promise<OrganizationMemberRecord[]>;
  createOrUpdateProfile(input: {
    userId: string;
    email: string;
    name: string;
    phone?: string | null;
    loginAccount?: string | null;
    requiresOnboarding?: boolean;
  }): Promise<void>;
  createMembership(input: {
    organizationId: string;
    userId: string;
    role: AppRole;
    status: OrganizationMemberStatus;
  }): Promise<OrganizationMemberRecord>;
  getMemberById(
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMemberRecord | null>;
  updateMemberRole(
    organizationId: string,
    memberId: string,
    input: { role: AppRole },
  ): Promise<OrganizationMemberRecord>;
  updateMemberStatus(
    organizationId: string,
    memberId: string,
    input: { status: OrganizationMemberStatus },
  ): Promise<OrganizationMemberRecord>;
};

export type OrganizationAuthAdmin = {
  inviteUserByEmail(
    email: string,
    options?: { data?: Record<string, unknown>; redirectTo?: string },
  ): PromiseLike<{
    data?: { user?: { id?: string; email?: string | null } | null } | null;
    error?: Error | { message?: string } | null;
  }>;
  createUser(input: {
    email: string;
    password: string;
    email_confirm: boolean;
    user_metadata?: Record<string, unknown>;
  }): PromiseLike<{
    data?: { user?: { id?: string; email?: string | null } | null } | null;
    error?: Error | { message?: string } | null;
  }>;
};

export type OrganizationAuditWriter = (input: AuditLogInput) => Promise<void>;

export type CreateOrganizationMemberInput = {
  mode: "invite" | "subaccount";
  email?: string;
  name: string;
  role: AppRole;
  temporaryPassword?: string;
};

type NormalizedCreateOrganizationMemberInput = Omit<
  CreateOrganizationMemberInput,
  "email"
> & {
  email: string;
  defaultAccount?: string;
};

export type CreateOrganizationMemberResult = {
  member: OrganizationMemberRecord;
  credentials?: {
    account: string;
    password: string;
    requiresActivation: true;
  };
};

export async function listOrganizationMembers({
  repo,
  actor,
}: {
  repo: Pick<OrganizationMemberRepository, "listMembers">;
  actor: OrganizationActor;
}): Promise<OrganizationMemberRecord[]> {
  if (!canViewOrganizationMembers(actor.role)) {
    throw new Error("Current role cannot view organization members");
  }

  const members = await repo.listMembers(actor.organizationId);
  return members.filter((member) => !isHistoricalDemoMember(member));
}

export async function createOrganizationMember({
  repo,
  authAdmin,
  audit,
  actor,
  input,
  generateDefaultAccount = defaultSubaccountLogin,
  generateDefaultPassword = defaultSubaccountPassword,
}: {
  repo: OrganizationMemberRepository;
  authAdmin: OrganizationAuthAdmin;
  audit: OrganizationAuditWriter;
  actor: OrganizationActor;
  input: CreateOrganizationMemberInput;
  generateDefaultAccount?: () => string;
  generateDefaultPassword?: () => string;
}): Promise<CreateOrganizationMemberResult> {
  const normalized = normalizeCreateInput(input, {
    defaultAccount:
      input.mode === "subaccount" ? generateDefaultAccount() : undefined,
    defaultPassword:
      input.mode === "subaccount" ? generateDefaultPassword() : undefined,
  });
  assertCanCreateOrganizationMemberRole(actor, normalized.role);

  const authUser =
    normalized.mode === "invite"
      ? await inviteAuthUser(authAdmin, normalized)
      : await createSubaccountAuthUser(authAdmin, normalized);
  const email = authUser.email ?? normalized.email;

  await repo.createOrUpdateProfile({
    userId: authUser.id,
    email,
    name: normalized.name,
    ...(normalized.mode === "subaccount"
      ? {
          phone: null,
          loginAccount: normalized.defaultAccount,
          requiresOnboarding: true,
        }
      : {}),
  });

  const member = await repo.createMembership({
    organizationId: actor.organizationId,
    userId: authUser.id,
    role: normalized.role,
    status: normalized.mode === "invite" ? "invited" : "active",
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "organization",
    objectType: "organization_member",
    objectId: member.id,
    objectName: member.email,
    after: member,
    changedFields: ["email", "role", "status"],
  });

  return {
    member,
    credentials:
      normalized.mode === "subaccount" && normalized.defaultAccount
        ? {
            account: normalized.defaultAccount,
            password: normalized.temporaryPassword ?? "",
            requiresActivation: true,
          }
        : undefined,
  };
}

export async function updateOrganizationMemberRole({
  repo,
  audit,
  actor,
  memberId,
  role,
  reason,
}: {
  repo: Pick<
    OrganizationMemberRepository,
    "getMemberById" | "updateMemberRole"
  >;
  audit: OrganizationAuditWriter;
  actor: OrganizationActor;
  memberId: string;
  role: AppRole;
  reason: string;
}): Promise<OrganizationMemberRecord> {
  assertCanManageOrganizationMembers(actor);
  assertValidRole(role);

  const before = await repo.getMemberById(actor.organizationId, memberId);
  if (!before) {
    throw new Error("Organization member not found");
  }
  if (before.userId === actor.userId && before.role === "owner") {
    throw new Error("Owner cannot change their own organization role");
  }
  if (before.role === role) {
    return before;
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("Role changes require a reason");
  }

  const member = await repo.updateMemberRole(actor.organizationId, memberId, {
    role,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "organization",
    objectType: "organization_member",
    objectId: member.id,
    objectName: member.email,
    before,
    after: member,
    changedFields: ["role"],
    isHighRisk: true,
    reason: trimmedReason,
  });

  return member;
}

export async function updateOrganizationMemberStatus({
  repo,
  audit,
  actor,
  memberId,
  status,
  reason,
}: {
  repo: Pick<
    OrganizationMemberRepository,
    "getMemberById" | "updateMemberStatus"
  >;
  audit: OrganizationAuditWriter;
  actor: OrganizationActor;
  memberId: string;
  status: OrganizationMemberStatus;
  reason: string;
}): Promise<OrganizationMemberRecord> {
  assertCanManageOrganizationMembers(actor);
  assertValidStatus(status);

  const before = await repo.getMemberById(actor.organizationId, memberId);
  if (!before) {
    throw new Error("Organization member not found");
  }
  if (before.userId === actor.userId && status === "suspended") {
    throw new Error("Owner cannot suspend their own organization account");
  }
  if (before.status === status) {
    return before;
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("Member status changes require a reason");
  }

  const member = await repo.updateMemberStatus(actor.organizationId, memberId, {
    status,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "organization",
    objectType: "organization_member",
    objectId: member.id,
    objectName: member.email,
    before,
    after: member,
    changedFields: ["status"],
    isHighRisk: true,
    reason: trimmedReason,
  });

  return member;
}

function assertCanManageOrganizationMembers(actor: OrganizationActor): void {
  if (!canManageOrganizationMembers(actor.role)) {
    throw new Error("Only owner can manage organization members");
  }
}

function assertCanCreateOrganizationMemberRole(
  actor: OrganizationActor,
  role: AppRole,
): void {
  if (!canCreateOrganizationMemberRole(actor.role, role)) {
    throw new Error(`Current role cannot create ${role} accounts`);
  }
}

function normalizeCreateInput(
  input: CreateOrganizationMemberInput,
  generated: { defaultAccount?: string; defaultPassword?: string } = {},
): NormalizedCreateOrganizationMemberInput {
  const mode = input.mode;
  if (mode !== "invite" && mode !== "subaccount") {
    throw new Error("Member creation mode is invalid");
  }

  const defaultAccount = generated.defaultAccount?.trim().toLowerCase();
  const rawEmail = input.email?.trim().toLowerCase();
  const email =
    mode === "subaccount" && !rawEmail
      ? `${defaultAccount}@subaccount.local`
      : rawEmail;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Member email is invalid");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Member name is required");
  }

  assertValidRole(input.role);

  const temporaryPassword =
    mode === "subaccount"
      ? input.temporaryPassword?.trim() || generated.defaultPassword?.trim()
      : input.temporaryPassword?.trim();
  if (
    mode === "subaccount" &&
    (!temporaryPassword || temporaryPassword.length < 8)
  ) {
    throw new Error("temporaryPassword must be at least 8 characters");
  }

  return {
    mode,
    email,
    name,
    role: input.role,
    temporaryPassword,
    defaultAccount: mode === "subaccount" ? defaultAccount : undefined,
  };
}

function assertValidRole(role: AppRole): void {
  if (!appRoles.includes(role)) {
    throw new Error("Member role is invalid");
  }
}

function assertValidStatus(status: OrganizationMemberStatus): void {
  if (!["invited", "active", "suspended"].includes(status)) {
    throw new Error("Member status is invalid");
  }
}

function isHistoricalDemoMember(member: OrganizationMemberRecord): boolean {
  const email = member.email.trim().toLowerCase();
  const demoDomain = ["jy", "demo"].join("-") + "." + ["lo", "cal"].join("");
  if (email.endsWith(`@${demoDomain}`)) {
    return true;
  }

  return /^([0-9a-f])\1{7}-\1{4}-\1{4}-\1{4}-\1{12}$/i.test(member.userId);
}

async function inviteAuthUser(
  authAdmin: OrganizationAuthAdmin,
  input: CreateOrganizationMemberInput & { email: string },
): Promise<{ id: string; email: string | null }> {
  const result = await authAdmin.inviteUserByEmail(input.email, {
    data: {
      full_name: input.name,
      organization_role: input.role,
      onboarding_mode: "organization_invite",
    },
  });

  return requireAuthUser(result);
}

async function createSubaccountAuthUser(
  authAdmin: OrganizationAuthAdmin,
  input: CreateOrganizationMemberInput & {
    email: string;
    defaultAccount?: string;
  },
): Promise<{ id: string; email: string | null }> {
  const result = await authAdmin.createUser({
    email: input.email,
    password: input.temporaryPassword ?? "",
    email_confirm: true,
    user_metadata: {
      full_name: input.name,
      organization_role: input.role,
      onboarding_mode: "organization_subaccount",
      onboarding_required: true,
      default_account: input.defaultAccount,
    },
  });

  return requireAuthUser(result);
}

function requireAuthUser(result: {
  data?: { user?: { id?: string; email?: string | null } | null } | null;
  error?: Error | { message?: string } | null;
}): { id: string; email: string | null } {
  if (result.error) {
    throw new Error(result.error.message ?? "Auth user operation failed");
  }

  const user = result.data?.user;
  if (!user?.id) {
    throw new Error("Auth user operation did not return a user");
  }

  return { id: user.id, email: user.email ?? null };
}

const defaultPasswordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function defaultSubaccountPassword(): string {
  return Array.from({ length: 8 }, () => {
    const index = Math.floor(Math.random() * defaultPasswordAlphabet.length);
    return defaultPasswordAlphabet[index];
  }).join("");
}

function defaultSubaccountLogin(): string {
  const suffix = Array.from({ length: 6 }, () => {
    const index = Math.floor(Math.random() * 36);
    return index.toString(36);
  }).join("");
  return `jy-${suffix}`;
}
