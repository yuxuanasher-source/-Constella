import { describe, expect, it, vi } from "vitest";

import { submitProjectRecording } from "./project-recording-delivery";

const actor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
  streamerId: "streamer-1",
};

const completeSelfCheck = {
  readConfirmed: true,
  dimensionScores: {
    product_understanding: 20,
    expression_control: 18,
    content_structure: 12,
    interaction_design: 12,
    commercial_task: 12,
    technical_compliance: 9,
  },
  keyMoments: [
    { key: "best_performance" as const, startSeconds: 30, endSeconds: 80 },
    { key: "selling_point" as const, startSeconds: 120, endSeconds: 180 },
    { key: "commercial_task" as const, startSeconds: 240, endSeconds: 300 },
  ],
  note: "Ready for review.",
};

function baseRepo() {
  return {
    getPublicProjectForRecording: vi.fn().mockResolvedValue({
      id: "project-1",
      name: "Public Project",
      organizationId: "org-1",
      status: "recruiting",
      isPublicToStreamers: true,
    }),
    getStreamerForAdmission: vi.fn().mockResolvedValue({
      id: "streamer-1",
      displayName: "Streamer One",
      userId: "user-streamer",
      riskLevel: "low",
    }),
    getApplicationByProjectAndStreamer: vi.fn().mockResolvedValue(null),
    getActiveCollaborationAgreement: vi.fn().mockResolvedValue(null),
    createApplication: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
      decisionReason: null,
    }),
    getApplicationById: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
      decisionReason: null,
    }),
    getProjectAdmissionConfig: vi.fn(),
    getLatestRecordingSubmission: vi.fn().mockResolvedValue(null),
    createRecordingSubmission: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "application-1",
      version: 1,
      status: "submitted",
    }),
    markApplicationRecordingReviewing: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_reviewing",
      decisionReason: null,
    }),
    updateApplicationStatus: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_reviewing",
      decisionReason: null,
    }),
    updateRecordingReview: vi.fn(),
    createProjectStreamer: vi.fn(),
  };
}

describe("submitProjectRecording", () => {
  it("creates a signup application and submits a recording to review", async () => {
    const repo = baseRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    const result = await submitProjectRecording({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/public-project",
        selfCheck: completeSelfCheck,
      },
    });

    expect(repo.createApplication).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
    });
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        applicationId: "application-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        version: 1,
        externalUrl: "https://videos.example.com/public-project",
      }),
    );
    expect(repo.markApplicationRecordingReviewing).toHaveBeenCalledWith(
      "application-1",
    );
    expect(repo.updateApplicationStatus).not.toHaveBeenCalled();
    expect(result).toEqual({
      applicationId: "application-1",
      projectId: "project-1",
      recording: {
        id: "recording-1",
        applicationId: "application-1",
        version: 1,
        status: "submitted",
      },
      reviewStatusLabel: "审核中",
    });
  });

  it("submits an uploaded private recording file without requiring an external link", async () => {
    const repo = baseRepo();

    await submitProjectRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        storagePath: "org-1/recordings/project-1/demo.mp4",
        durationSeconds: 900,
        selfCheck: completeSelfCheck,
      },
    });

    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "org-1/recordings/project-1/demo.mp4",
        externalUrl: undefined,
        durationSeconds: 900,
      }),
    );
  });

  it.each([
    "org-2/recordings/project-1/demo.mp4",
    "org-1/recordings/%252e%252e/demo.mp4",
  ])(
    "rejects invalid uploaded storage path before creating an application: %s",
    async (storagePath) => {
      const repo = baseRepo();

      await expect(
        submitProjectRecording({
          repo,
          audit: vi.fn(),
          notify: vi.fn(),
          actor,
          input: {
            projectId: "project-1",
            streamerId: "streamer-1",
            storagePath,
          },
        }),
      ).rejects.toThrow("Invalid recording storage path");

      expect(repo.createApplication).not.toHaveBeenCalled();
      expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    },
  );

  it("uses an existing submittable application and increments recording version", async () => {
    const repo = baseRepo();
    repo.getApplicationByProjectAndStreamer.mockResolvedValue({
      id: "application-existing",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_rejected",
      decisionReason: "Please resubmit",
    });
    repo.getApplicationById.mockResolvedValue({
      id: "application-existing",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_rejected",
      decisionReason: "Please resubmit",
    });
    repo.getLatestRecordingSubmission.mockResolvedValue({
      id: "recording-old",
      applicationId: "application-existing",
      version: 2,
      status: "rejected",
    });
    repo.createRecordingSubmission.mockResolvedValue({
      id: "recording-3",
      applicationId: "application-existing",
      version: 3,
      status: "submitted",
    });

    await submitProjectRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/resubmit",
        selfCheck: completeSelfCheck,
      },
    });

    expect(repo.createApplication).not.toHaveBeenCalled();
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "application-existing",
        version: 3,
      }),
    );
    expect(repo.markApplicationRecordingReviewing).toHaveBeenCalledWith(
      "application-existing",
    );
  });

  it("rejects projects outside the actor organization or hidden from streamers", async () => {
    const repo = baseRepo();
    repo.getPublicProjectForRecording.mockResolvedValue({
      id: "project-2",
      name: "Hidden Project",
      organizationId: "org-2",
      status: "recruiting",
      isPublicToStreamers: true,
    });

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-2",
          streamerId: "streamer-1",
          link: "https://videos.example.com/hidden",
          selfCheck: completeSelfCheck,
        },
      }),
    ).rejects.toThrow("Project is not available for recording delivery");
  });

  it("rejects missing self-check before creating a recording submission", async () => {
    const repo = baseRepo();

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/missing-self-check",
        },
      }),
    ).rejects.toThrow("Recording self-check is required");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects malformed self-check objects before normalization throws raw runtime errors", async () => {
    const repo = baseRepo();

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/malformed-self-check",
          selfCheck: {
            readConfirmed: true,
            dimensionScores: completeSelfCheck.dimensionScores,
          } as never,
        },
      }),
    ).rejects.toThrow("Recording self-check is required");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects self-check payloads missing one score with a controlled error", async () => {
    const repo = baseRepo();
    const dimensionScores: Record<string, number> = {
      ...completeSelfCheck.dimensionScores,
    };
    delete dimensionScores.product_understanding;

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/missing-score",
          selfCheck: {
            ...completeSelfCheck,
            dimensionScores,
          },
        },
      }),
    ).rejects.toThrow("Recording self-check is required");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects self-check payloads missing one key moment with a controlled error", async () => {
    const repo = baseRepo();

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/missing-key-moment",
          selfCheck: {
            ...completeSelfCheck,
            keyMoments: completeSelfCheck.keyMoments.filter(
              (moment) => moment.key !== "selling_point",
            ),
          },
        },
      }),
    ).rejects.toThrow("Recording self-check is required");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects when the task card has not been confirmed", async () => {
    const repo = baseRepo();

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/unconfirmed",
          selfCheck: {
            ...completeSelfCheck,
            readConfirmed: false,
          },
        },
      }),
    ).rejects.toThrow("Recording task card must be confirmed before submission");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("stores low self-score evidence without blocking submission", async () => {
    const repo = baseRepo();

    const result = await submitProjectRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/low-self-score",
        selfCheck: {
          readConfirmed: true,
          dimensionScores: {
            product_understanding: 8,
            expression_control: 8,
            content_structure: 7,
            interaction_design: 7,
            commercial_task: 6,
            technical_compliance: 6,
          },
          keyMoments: [
            { key: "best_performance", startSeconds: 10, endSeconds: 20 },
            { key: "selling_point", startSeconds: 30, endSeconds: 45 },
            { key: "commercial_task", startSeconds: 50, endSeconds: 70 },
          ],
          note: "Self score is low; please give revision advice.",
        },
      },
    });

    expect(result.recording.status).toBe("submitted");
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        selfCheck: expect.objectContaining({
          totalScore: 42,
          selfLevel: "L0",
          note: "Self score is low; please give revision advice.",
        }),
      }),
    );
    expect(repo.updateApplicationStatus).not.toHaveBeenCalled();
  });
});
