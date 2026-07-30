export type AdmissionShareMode = "preview" | "formal_review";
export type AdmissionShareReviewState =
  | "not_started"
  | "viewed"
  | "in_progress"
  | "submitted_locked";
export type AdmissionShareSourceHealth =
  | "original_ready"
  | "original_with_external_fallback"
  | "external_only"
  | "blocked";
export type AdmissionSharePreflightStatus = "ready" | "warning" | "blocked";

export type AdmissionShareSelectionInput = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  sortOrder: number;
};

export type AdmissionShareCandidateSource = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  mcnReviewDecision: "approved" | "rejected" | "needs_changes" | null;
  hasPrivateStorage: boolean;
  externalUrl: string | null;
};

export function classifyAdmissionShareSource(
  hasPrivateStorage: boolean,
  externalUrl: string | null,
) {
  const hasOriginal = hasPrivateStorage;
  const hasExternal = isSafeExternalUrl(externalUrl);

  if (hasOriginal && hasExternal) {
    return {
      status: "ready" as const,
      sourceHealth: "original_with_external_fallback" as const,
      reasonCode: null,
    };
  }
  if (hasOriginal) {
    return {
      status: "ready" as const,
      sourceHealth: "original_ready" as const,
      reasonCode: null,
    };
  }
  if (hasExternal) {
    return {
      status: "warning" as const,
      sourceHealth: "external_only" as const,
      reasonCode: "EXTERNAL_ONLY" as const,
    };
  }
  return {
    status: "blocked" as const,
    sourceHealth: "blocked" as const,
    reasonCode: "SOURCE_UNAVAILABLE" as const,
  };
}

export function preflightAdmissionShareSelection(
  candidates: AdmissionShareCandidateSource[],
  selections: AdmissionShareSelectionInput[],
) {
  const byRecording = new Map(
    candidates.map((candidate) => [candidate.recordingSubmissionId, candidate]),
  );
  const items = selections
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((selection) => {
      const candidate = byRecording.get(selection.recordingSubmissionId);
      if (
        !candidate ||
        candidate.applicationId !== selection.applicationId ||
        candidate.recordingVersion !== selection.recordingVersion
      ) {
        return {
          ...selection,
          status: "blocked" as const,
          sourceHealth: "blocked" as const,
          reasonCode: "SELECTION_STALE" as const,
        };
      }
      if (candidate.mcnReviewDecision !== "approved") {
        return {
          ...selection,
          status: "blocked" as const,
          sourceHealth: "blocked" as const,
          reasonCode: "MCN_APPROVAL_REQUIRED" as const,
        };
      }
      return {
        ...selection,
        ...classifyAdmissionShareSource(
          candidate.hasPrivateStorage,
          candidate.externalUrl,
        ),
      };
    });

  return {
    items,
    summary: {
      ready: items.filter((item) => item.status === "ready").length,
      warning: items.filter((item) => item.status === "warning").length,
      blocked: items.filter((item) => item.status === "blocked").length,
    },
  };
}

function isSafeExternalUrl(value: string | null) {
  if (!value?.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
