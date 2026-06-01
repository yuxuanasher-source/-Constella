export const appRoles = [
  "owner",
  "ops_manager",
  "operator_business",
  "finance",
  "streamer",
] as const;

export type AppRole = (typeof appRoles)[number];

export function isMcnStaff(role: AppRole | null | undefined): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "operator_business" ||
    role === "finance"
  );
}
