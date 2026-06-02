export const applicationStatuses = [
  "submitted",
  "invited",
  "recording_required",
  "recording_reviewing",
  "recording_approved",
  "recording_rejected",
  "confirmed",
  "declined",
  "joined",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export const recordingReviewStatuses = [
  "submitted",
  "reviewing",
  "approved",
  "rejected",
  "needs_changes",
] as const;

export type RecordingReviewStatus = (typeof recordingReviewStatuses)[number];

const allowedApplicationTransitions: Record<
  ApplicationStatus,
  ApplicationStatus[]
> = {
  submitted: ["recording_required", "recording_reviewing", "withdrawn"],
  invited: [
    "recording_required",
    "recording_reviewing",
    "declined",
    "withdrawn",
  ],
  recording_required: ["recording_reviewing", "withdrawn"],
  recording_reviewing: [
    "recording_approved",
    "recording_rejected",
    "recording_required",
  ],
  recording_approved: ["joined", "declined"],
  recording_rejected: ["recording_reviewing", "withdrawn"],
  confirmed: ["recording_required", "recording_reviewing", "declined"],
  declined: [],
  joined: ["withdrawn"],
  withdrawn: [],
};

const recordingSubmittableStatuses = new Set<ApplicationStatus>([
  "submitted",
  "invited",
  "recording_required",
  "recording_rejected",
]);

export function assertApplicationTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (!allowedApplicationTransitions[from]?.includes(to)) {
    throw new Error(`Cannot move application from ${from} to ${to}`);
  }
}

export function assertCanSubmitRecording(status: ApplicationStatus): void {
  if (!recordingSubmittableStatuses.has(status)) {
    throw new Error(`Cannot submit recording while application is ${status}`);
  }
}

export function mapRecordingDecisionToApplicationStatus(
  decision: RecordingReviewStatus,
): ApplicationStatus {
  if (decision === "approved") {
    return "recording_approved";
  }

  if (decision === "rejected") {
    return "recording_rejected";
  }

  if (decision === "needs_changes") {
    return "recording_required";
  }

  return "recording_reviewing";
}
