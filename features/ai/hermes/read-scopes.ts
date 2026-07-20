import type { HermesAuthRole, HermesReadScope } from "./contracts";

export const HERMES_READ_SCOPES: readonly HermesReadScope[] = [
  "context.read",
  "projects.search",
  "projects.summary",
  "streamers.project_profile",
  "live_reports.search",
  "recording_reviews.search",
  "knowledge.search",
  "settlements.summary",
];

const ROLE_SCOPE_BASELINE: Record<HermesAuthRole, readonly HermesReadScope[]> =
  {
    owner: HERMES_READ_SCOPES,
    ops_manager: HERMES_READ_SCOPES,
    operator_business: [
      "context.read",
      "projects.search",
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
    ],
    finance: [
      "context.read",
      "projects.search",
      "projects.summary",
      "knowledge.search",
      "settlements.summary",
    ],
    streamer: HERMES_READ_SCOPES,
  };

export function getAllowedReadScopesForRole(role: unknown): HermesReadScope[] {
  if (typeof role !== "string" || !(role in ROLE_SCOPE_BASELINE)) {
    return [];
  }
  return [...ROLE_SCOPE_BASELINE[role as HermesAuthRole]];
}
