const preSettlementProjectStatuses = new Set([
  "recruiting",
  "pending_start",
  "active",
  "paused",
  "ended",
]);

export function canShareAdmissionRecordingsForProject(
  projectStatus: string | null | undefined,
) {
  return Boolean(
    projectStatus && preSettlementProjectStatuses.has(projectStatus),
  );
}
