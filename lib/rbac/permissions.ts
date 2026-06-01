import type { AppRole } from "./roles";

export function canCreateProjectDraft(role: AppRole | null | undefined): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "operator_business"
  );
}

export function canPublishProject(role: AppRole | null | undefined): boolean {
  return role === "owner" || role === "ops_manager";
}

export function canSeeFinancialFields(role: AppRole | null | undefined): boolean {
  return role === "owner" || role === "finance";
}
