export type { PublicAdmissionShareBoard } from "@/features/applications/admission-share-board";
export type { VendorAdmissionDecision } from "@/features/applications/admission-board";

export type ReviewDraft = {
  decision: import("@/features/applications/admission-board").VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
  revision: number;
  updatedAt: string | null;
};

export type AdmissionShareReviewDraftDto = ReviewDraft & {
  recordingSubmissionId: string;
  recordingVersion: number;
};

export type ReviewDraftSaveState = "idle" | "saving" | "saved" | "failed";

export type VendorCheckpointOption = {
  key: string;
  label: string;
  description: string;
};

export type PublicAdmissionShareBoardResponse = {
  shareBoard: import("@/features/applications/admission-share-board").PublicAdmissionShareBoard;
  vendorCheckpoints: VendorCheckpointOption[];
  reviewDrafts?: AdmissionShareReviewDraftDto[];
};

export type AdmissionShareReviewSubmitResult = {
  submissionRevision: number;
  submittedCount: number;
  syncedCount: number;
  skippedCount: number;
};

export type AdmissionSharePlaybackSource = "original" | "external" | "none";

export type AdmissionSharePlaybackErrorCode =
  | "MEDIA_LOAD_FAILED"
  | "MEDIA_DECODE_FAILED"
  | "EXTERNAL_LINK_FAILED"
  | "NO_PLAYABLE_SOURCE";
