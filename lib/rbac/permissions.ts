import type { AppRole } from "./roles";

export function canCreateProjectDraft(
  role: AppRole | null | undefined,
): boolean {
  return (
    role === "owner" || role === "ops_manager" || role === "operator_business"
  );
}

export function canPublishProject(role: AppRole | null | undefined): boolean {
  return role === "owner" || role === "ops_manager";
}

export function canAssignProjectOwner(
  role: AppRole | null | undefined,
): boolean {
  return role === "owner" || role === "ops_manager";
}

export function canSeeFinancialFields(
  role: AppRole | null | undefined,
): boolean {
  return role === "owner" || role === "finance";
}

export function canViewOrganizationMembers(
  role: AppRole | null | undefined,
): boolean {
  return role === "owner" || role === "ops_manager";
}

export function canManageOcrJobs(role: AppRole | null | undefined): boolean {
  return (
    role === "owner" || role === "ops_manager" || role === "operator_business"
  );
}

export function getCreatableOrganizationMemberRoles(
  role: AppRole | null | undefined,
): AppRole[] {
  if (role === "owner") {
    return ["owner", "ops_manager", "operator_business", "finance", "streamer"];
  }

  if (role === "ops_manager") {
    return ["ops_manager", "operator_business", "streamer"];
  }

  if (role === "operator_business") {
    return ["streamer"];
  }

  return [];
}

export function canCreateOrganizationMemberRole(
  creatorRole: AppRole | null | undefined,
  targetRole: AppRole | null | undefined,
): boolean {
  if (!targetRole) {
    return false;
  }

  return getCreatableOrganizationMemberRoles(creatorRole).includes(targetRole);
}

export function canManageOrganizationMembers(
  role: AppRole | null | undefined,
): boolean {
  return role === "owner";
}

export function canManageOrganizationSettings(
  role: AppRole | null | undefined,
): boolean {
  return role === "owner";
}
