import { describe, expect, it } from "vitest";

import {
  classifyAdmissionShareSource,
  preflightAdmissionShareSelection,
} from "./admission-share-workflow";

describe("admission share workflow", () => {
  it("keeps a historically MCN-approved version shareable after vendor rejection", () => {
    expect(
      preflightAdmissionShareSelection(
        [
          {
            applicationId: "app-1",
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
            mcnReviewDecision: "approved",
            hasPrivateStorage: true,
            externalUrl: null,
          },
        ],
        [
          {
            applicationId: "app-1",
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      ).items[0],
    ).toMatchObject({ status: "ready", sourceHealth: "original_ready" });
  });

  it("blocks only the invalid selected item", () => {
    const result = preflightAdmissionShareSelection(
      [
        {
          applicationId: "app-1",
          recordingSubmissionId: "ready",
          recordingVersion: 1,
          mcnReviewDecision: "approved",
          hasPrivateStorage: true,
          externalUrl: null,
        },
        {
          applicationId: "app-2",
          recordingSubmissionId: "blocked",
          recordingVersion: 1,
          mcnReviewDecision: null,
          hasPrivateStorage: true,
          externalUrl: null,
        },
      ],
      [
        {
          applicationId: "app-1",
          recordingSubmissionId: "ready",
          recordingVersion: 1,
          sortOrder: 0,
        },
        {
          applicationId: "app-2",
          recordingSubmissionId: "blocked",
          recordingVersion: 1,
          sortOrder: 1,
        },
      ],
    );

    expect(result.summary).toEqual({ ready: 1, warning: 0, blocked: 1 });
    expect(result.items.map((item) => item.status)).toEqual([
      "ready",
      "blocked",
    ]);
  });

  it("marks safe external-only recordings as a warning", () => {
    expect(
      classifyAdmissionShareSource(false, "https://video.example/v1"),
    ).toEqual({
      status: "warning",
      sourceHealth: "external_only",
      reasonCode: "EXTERNAL_ONLY",
    });
  });
});
