import { randomUUID } from "node:crypto";

import type { BillingCycle } from "@/features/billing/order-types";
import {
  normalizeOrganizationMemberInput,
  provisionOrganizationMemberAuthUser,
  type CreateOrganizationMemberInput,
  type OrganizationAuthAdmin,
  type OrganizationMemberRecord,
  type OrganizationMemberStatus,
} from "@/features/organizations/organization-service";
import type { AppRole } from "@/lib/rbac/roles";

import type { PlatformAdminContext } from "./platform-admin-auth";
import type { OrganizationLifecycleStatus } from "./platform-admin-contracts";
import {
  PlatformAdminConflictError,
  PlatformAdminValidationError,
} from "./platform-admin-errors";
import { executePlatformAdminOperation } from "./platform-admin-mutations";
import {
  hashPlatformAdminRequest,
  redactPlatformAdminError,
  redactPlatformAdminPayload,
  type PlatformAdminOperationLog,
} from "./platform-admin-operation-log";

export type PlatformOrganizationRecord = {
  id: string;
  name: string;
  code: string;
  lifecycleStatus: OrganizationLifecycleStatus;
  updatedAt: string;
};

export type PlatformOrganizationAuthAdmin = OrganizationAuthAdmin & {
  deleteUser(userId: string): PromiseLike<{
    error?: Error | { message?: string } | null;
  }>;
  sendPasswordReset(email: string): Promise<void>;
};

export type PlatformOrganizationCreateResult = {
  organizationId: string;
  subscriptionId: string;
  primaryUserId: string;
  orderId: string | null;
  transactionId: string | null;
};

export type CreatePlatformOrganizationCommand = {
  name: string;
  code: string;
  primaryEmail: string;
  primaryName: string;
  primaryPassword: string;
  planId: string;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  offlinePayment: {
    amountCents: number;
    currency?: string;
    provider?: string;
    providerTransactionId?: string;
    paidAt?: string;
  } | null;
  reason: string;
  traceId?: string;
  idempotencyKey: string;
};

export type PlatformAdminMutationRepository = {
  operationLog: PlatformAdminOperationLog;
  createOrganizationAtomic(input: {
    actorUserId: string;
    name: string;
    code: string;
    primaryUserId: string;
    primaryEmail: string;
    primaryName: string;
    planId: string;
    billingCycle: BillingCycle;
    periodStart: string;
    periodEnd: string;
    offlinePayment: CreatePlatformOrganizationCommand["offlinePayment"];
    reason: string;
    traceId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<PlatformOrganizationCreateResult>;
  getOrganization(
    organizationId: string,
  ): Promise<PlatformOrganizationRecord | null>;
  updateOrganizationLifecycle(
    organizationId: string,
    status: OrganizationLifecycleStatus,
    expectedUpdatedAt: string,
  ): Promise<PlatformOrganizationRecord>;
  updateOrganizationIdentity(
    organizationId: string,
    input: { name?: string; code?: string },
    expectedUpdatedAt: string,
  ): Promise<PlatformOrganizationRecord>;
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
  getMember(
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMemberRecord | null>;
  updateMemberRole(
    organizationId: string,
    memberId: string,
    role: AppRole,
    expectedUpdatedAt: string,
  ): Promise<OrganizationMemberRecord>;
  updateMemberStatus(
    organizationId: string,
    memberId: string,
    status: OrganizationMemberStatus,
    expectedUpdatedAt: string,
  ): Promise<OrganizationMemberRecord>;
  isPrimaryAccount(
    organizationId: string,
    userId: string,
  ): Promise<boolean>;
  countOtherActiveOwners(
    organizationId: string,
    userId: string,
  ): Promise<number>;
};

export async function createPlatformOrganization(input: {
  repo: PlatformAdminMutationRepository;
  authAdmin: PlatformOrganizationAuthAdmin;
  actor: PlatformAdminContext;
  command: CreatePlatformOrganizationCommand;
}): Promise<PlatformOrganizationCreateResult> {
  const command = normalizeCreateOrganizationCommand(input.command);
  const requestHash = hashPlatformAdminRequest({
    ...command,
    traceId: undefined,
  });
  const existing = await input.repo.operationLog.findByIdempotency({
    actorUserId: input.actor.userId,
    idempotencyKey: command.idempotencyKey,
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new PlatformAdminConflictError(
        "Idempotency key was already used for a different request.",
      );
    }
    if (existing.result === "success") {
      return normalizeCreateResult(existing.resultValue);
    }
    throw new PlatformAdminConflictError(
      "A prior attempt with this idempotency key failed. Retry with a new key.",
    );
  }

  const traceId = command.traceId ?? randomUUID();
  let primaryUser: { id: string; email: string | null } | null = null;

  try {
    const authResult = await input.authAdmin.createUser({
      email: command.primaryEmail,
      password: command.primaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: command.primaryName,
        organization_role: "owner",
        onboarding_mode: "platform_admin",
      },
    });
    primaryUser = requireAuthUser(authResult);
    return await input.repo.createOrganizationAtomic({
      actorUserId: input.actor.userId,
      name: command.name,
      code: command.code,
      primaryUserId: primaryUser.id,
      primaryEmail: primaryUser.email ?? command.primaryEmail,
      primaryName: command.primaryName,
      planId: command.planId,
      billingCycle: command.billingCycle,
      periodStart: command.periodStart,
      periodEnd: command.periodEnd,
      offlinePayment: command.offlinePayment,
      reason: command.reason,
      traceId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    });
  } catch (error) {
    if (primaryUser) {
      await input.authAdmin.deleteUser(primaryUser.id);
    }
    const request = redactPlatformAdminPayload({
      ...command,
      traceId: undefined,
    });
    await input.repo.operationLog.write({
      actorUserId: input.actor.userId,
      action: "organization.create",
      target: { type: "organization" },
      reason: command.reason,
      highRisk: true,
      requestHash,
      request,
      before: {},
      after: {},
      result: "failure",
      errorMessage: redactPlatformAdminError(error, command),
      traceId,
      idempotencyKey: command.idempotencyKey,
    });
    throw error;
  }
}

export async function setPlatformOrganizationLifecycle(input: {
  repo: PlatformAdminMutationRepository;
  actor: PlatformAdminContext;
  organizationId: string;
  status: OrganizationLifecycleStatus;
  expectedUpdatedAt: string;
  reason: string;
  idempotencyKey: string;
}): Promise<PlatformOrganizationRecord> {
  return executePlatformAdminOperation({
    actor: input.actor,
    action: `organization.${input.status}`,
    target: { type: "organization", id: input.organizationId },
    reason: input.reason,
    highRisk: true,
    idempotencyKey: input.idempotencyKey,
    request: {
      organizationId: input.organizationId,
      status: input.status,
      expectedUpdatedAt: input.expectedUpdatedAt,
    },
    loadBefore: async () =>
      organizationSnapshot(
        await requireOrganization(input.repo, input.organizationId),
      ),
    execute: () =>
      input.repo.updateOrganizationLifecycle(
        input.organizationId,
        input.status,
        input.expectedUpdatedAt,
      ),
    summarizeAfter: organizationSnapshot,
    log: input.repo.operationLog,
  });
}

export async function updatePlatformOrganizationIdentity(input: {
  repo: PlatformAdminMutationRepository;
  actor: PlatformAdminContext;
  organizationId: string;
  name?: string;
  code?: string;
  expectedUpdatedAt: string;
  reason: string;
  idempotencyKey: string;
}): Promise<PlatformOrganizationRecord> {
  const patch = normalizeOrganizationIdentity(input);
  return executePlatformAdminOperation({
    actor: input.actor,
    action: "organization.update",
    target: { type: "organization", id: input.organizationId },
    reason: input.reason,
    highRisk: true,
    idempotencyKey: input.idempotencyKey,
    request: {
      ...patch,
      expectedUpdatedAt: input.expectedUpdatedAt,
    },
    loadBefore: async () =>
      organizationSnapshot(
        await requireOrganization(input.repo, input.organizationId),
      ),
    execute: () =>
      input.repo.updateOrganizationIdentity(
        input.organizationId,
        patch,
        input.expectedUpdatedAt,
      ),
    summarizeAfter: organizationSnapshot,
    log: input.repo.operationLog,
  });
}

export async function createPlatformOrganizationMember(input: {
  repo: PlatformAdminMutationRepository;
  authAdmin: PlatformOrganizationAuthAdmin;
  actor: PlatformAdminContext;
  organizationId: string;
  command: CreateOrganizationMemberInput & {
    reason: string;
    idempotencyKey: string;
  };
  generateDefaultAccount?: () => string;
  generateDefaultPassword?: () => string;
}) {
  const organization = await requireOrganization(
    input.repo,
    input.organizationId,
  );
  if (organization.lifecycleStatus === "archived") {
    throw new PlatformAdminValidationError(
      "Archived organizations cannot add accounts.",
    );
  }

  const command = normalizeOrganizationMemberInput(input.command, {
    defaultAccount:
      input.command.mode === "subaccount"
        ? (input.generateDefaultAccount?.() ?? defaultSubaccountLogin())
        : undefined,
    defaultPassword:
      input.command.mode === "subaccount"
        ? (input.generateDefaultPassword?.() ?? defaultSubaccountPassword())
        : undefined,
  });

  return executePlatformAdminOperation({
    actor: input.actor,
    action: "organization.member.create",
    target: {
      type: "organization_member",
      organizationId: input.organizationId,
    },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      organizationId: input.organizationId,
      mode: command.mode,
      email: command.email,
      name: command.name,
      role: command.role,
      temporaryPassword: command.temporaryPassword,
    },
    execute: async () => {
      const authUser = await provisionOrganizationMemberAuthUser(
        input.authAdmin,
        command,
      );
      try {
        const email = authUser.email ?? command.email;
        await input.repo.createOrUpdateProfile({
          userId: authUser.id,
          email,
          name: command.name,
          ...(command.mode === "subaccount"
            ? {
                phone: null,
                loginAccount: command.defaultAccount,
                requiresOnboarding: true,
              }
            : {}),
        });
        const member = await input.repo.createMembership({
          organizationId: input.organizationId,
          userId: authUser.id,
          role: command.role,
          status: command.mode === "invite" ? "invited" : "active",
        });
        return {
          member,
          credentials:
            command.mode === "subaccount" && command.defaultAccount
              ? {
                  account: command.defaultAccount,
                  password: command.temporaryPassword ?? "",
                  requiresActivation: true as const,
                }
              : undefined,
        };
      } catch (error) {
        await input.authAdmin.deleteUser(authUser.id);
        throw error;
      }
    },
    summarizeAfter: (result) => ({
      member: memberSnapshot(result.member),
      credentialsIssued: Boolean(result.credentials),
    }),
    log: input.repo.operationLog,
  });
}

export async function updatePlatformOrganizationMember(input: {
  repo: PlatformAdminMutationRepository;
  authAdmin: PlatformOrganizationAuthAdmin;
  actor: PlatformAdminContext;
  organizationId: string;
  memberId: string;
  command: {
    role?: AppRole;
    status?: OrganizationMemberStatus;
    sendPasswordReset?: true;
    expectedUpdatedAt: string;
    reason: string;
    idempotencyKey: string;
  };
}) {
  const actionCount = [
    input.command.role !== undefined,
    input.command.status !== undefined,
    input.command.sendPasswordReset === true,
  ].filter(Boolean).length;
  if (actionCount !== 1) {
    throw new PlatformAdminValidationError(
      "Exactly one member action is required.",
    );
  }

  const before = await requireMember(
    input.repo,
    input.organizationId,
    input.memberId,
  );
  await assertActiveOwnerRemains(input, before);

  const action = input.command.sendPasswordReset
    ? "organization.member.password_reset"
    : input.command.role !== undefined
      ? "organization.member.role"
      : "organization.member.status";

  return executePlatformAdminOperation({
    actor: input.actor,
    action,
    target: {
      type: "organization_member",
      id: input.memberId,
      organizationId: input.organizationId,
    },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      organizationId: input.organizationId,
      memberId: input.memberId,
      role: input.command.role,
      status: input.command.status,
      sendPasswordReset: input.command.sendPasswordReset,
      expectedUpdatedAt: input.command.expectedUpdatedAt,
    },
    loadBefore: async () => memberSnapshot(before),
    execute: async () => {
      if (input.command.role !== undefined) {
        return input.repo.updateMemberRole(
          input.organizationId,
          input.memberId,
          input.command.role,
          input.command.expectedUpdatedAt,
        );
      }
      if (input.command.status !== undefined) {
        return input.repo.updateMemberStatus(
          input.organizationId,
          input.memberId,
          input.command.status,
          input.command.expectedUpdatedAt,
        );
      }
      await input.authAdmin.sendPasswordReset(before.email);
      return before;
    },
    summarizeAfter: memberSnapshot,
    log: input.repo.operationLog,
  });
}

async function assertActiveOwnerRemains(
  input: Parameters<typeof updatePlatformOrganizationMember>[0],
  member: OrganizationMemberRecord,
) {
  const removesActiveOwner =
    member.role === "owner" &&
    member.status === "active" &&
    ((input.command.role !== undefined && input.command.role !== "owner") ||
      (input.command.status !== undefined &&
        input.command.status !== "active"));
  if (!removesActiveOwner) {
    return;
  }
  const isPrimary = await input.repo.isPrimaryAccount(
    input.organizationId,
    member.userId,
  );
  if (
    isPrimary &&
    (await input.repo.countOtherActiveOwners(
      input.organizationId,
      member.userId,
    )) === 0
  ) {
    throw new PlatformAdminValidationError(
      "The organization must retain at least one active owner.",
    );
  }
}

function normalizeCreateOrganizationCommand(
  command: CreatePlatformOrganizationCommand,
): CreatePlatformOrganizationCommand {
  const normalized = {
    ...command,
    name: command.name.trim(),
    code: command.code.trim().toLowerCase(),
    primaryEmail: command.primaryEmail.trim().toLowerCase(),
    primaryName: command.primaryName.trim(),
    reason: command.reason.trim(),
    idempotencyKey: command.idempotencyKey.trim(),
  };
  if (
    !normalized.name ||
    !normalized.code ||
    !normalized.primaryName ||
    !normalized.reason ||
    !normalized.idempotencyKey
  ) {
    throw new PlatformAdminValidationError(
      "Organization, primary account, reason, and idempotency key are required.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.primaryEmail)) {
    throw new PlatformAdminValidationError(
      "Primary account email is invalid.",
    );
  }
  if (normalized.primaryPassword.length < 8) {
    throw new PlatformAdminValidationError(
      "Primary account password must be at least 8 characters.",
    );
  }
  if (normalized.periodEnd < normalized.periodStart) {
    throw new PlatformAdminValidationError(
      "Subscription period is invalid.",
    );
  }
  return normalized;
}

function normalizeOrganizationIdentity(input: {
  name?: string;
  code?: string;
}) {
  const patch = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.code !== undefined
      ? { code: input.code.trim().toLowerCase() }
      : {}),
  };
  if (
    Object.keys(patch).length === 0 ||
    ("name" in patch && !patch.name) ||
    ("code" in patch && !patch.code)
  ) {
    throw new PlatformAdminValidationError(
      "A non-empty organization name or code is required.",
    );
  }
  return patch;
}

async function requireOrganization(
  repo: PlatformAdminMutationRepository,
  organizationId: string,
) {
  const organization = await repo.getOrganization(organizationId);
  if (!organization) {
    throw new PlatformAdminValidationError("Organization not found.");
  }
  return organization;
}

async function requireMember(
  repo: PlatformAdminMutationRepository,
  organizationId: string,
  memberId: string,
) {
  const member = await repo.getMember(organizationId, memberId);
  if (!member) {
    throw new PlatformAdminValidationError("Organization member not found.");
  }
  return member;
}

function requireAuthUser(result: {
  data?: { user?: { id?: string; email?: string | null } | null } | null;
  error?: Error | { message?: string } | null;
}) {
  if (result.error) {
    throw new Error(result.error.message ?? "Auth user operation failed");
  }
  const user = result.data?.user;
  if (!user?.id) {
    throw new Error("Auth user operation did not return a user");
  }
  return { id: user.id, email: user.email ?? null };
}

function normalizeCreateResult(value: unknown): PlatformOrganizationCreateResult {
  if (!value || typeof value !== "object") {
    throw new PlatformAdminConflictError(
      "The prior organization creation result is unavailable.",
    );
  }
  const result = value as Record<string, unknown>;
  const organizationId = result.organizationId ?? result.organization_id;
  const subscriptionId = result.subscriptionId ?? result.subscription_id;
  const primaryUserId = result.primaryUserId ?? result.primary_user_id;
  if (
    typeof organizationId !== "string" ||
    typeof subscriptionId !== "string" ||
    typeof primaryUserId !== "string"
  ) {
    throw new PlatformAdminConflictError(
      "The prior organization creation result is invalid.",
    );
  }
  const orderId = result.orderId ?? result.order_id;
  const transactionId = result.transactionId ?? result.transaction_id;
  return {
    organizationId,
    subscriptionId,
    primaryUserId,
    orderId: typeof orderId === "string" ? orderId : null,
    transactionId: typeof transactionId === "string" ? transactionId : null,
  };
}

function organizationSnapshot(
  organization: PlatformOrganizationRecord,
): Record<string, unknown> {
  return { ...organization };
}

function memberSnapshot(
  member: OrganizationMemberRecord,
): Record<string, unknown> {
  return { ...member };
}

const passwordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function defaultSubaccountPassword() {
  return Array.from({ length: 12 }, () => {
    const index = Math.floor(Math.random() * passwordAlphabet.length);
    return passwordAlphabet[index];
  }).join("");
}

function defaultSubaccountLogin() {
  return `jy-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}
