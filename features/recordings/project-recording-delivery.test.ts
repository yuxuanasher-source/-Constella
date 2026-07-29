import { describe, expect, it, vi } from "vitest";

import { submitProjectRecording } from "./project-recording-delivery";

const actor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
  streamerId: "streamer-1",
};

const staffActor = {
  userId: "user-ops",
  name: "Business Operator",
  role: "operator_business" as const,
  organizationId: "org-1",
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
    getProjectAdmissionConfig: vi.fn().mockResolvedValue({
      id: "project-1",
      name: "Private Project",
      organizationId: "org-1",
      status: "recruiting",
      openSignup: false,
      allowDirectInvite: true,
      forceRecording: true,
      defaultSettlementMethod: "manual",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultSettlementRule: {},
    }),
    getLatestRecordingSubmission: vi.fn().mockResolvedValue(null),
    createRecordingSubmission: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "application-1",
      version: 1,
      status: "submitted",
      uploadedBy: "user-streamer",
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
        uploadedBy: "user-streamer",
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
        uploadedBy: "user-streamer",
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

  it("lets staff proxy-upload to a non-public own-organization project", async () => {
    const repo = baseRepo();
    repo.createRecordingSubmission.mockResolvedValue({
      id: "recording-proxy",
      applicationId: "application-1",
      version: 1,
      status: "submitted",
      uploadedBy: staffActor.userId,
    });

    const result = await submitProjectRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/operator-proxy",
      },
    });

    expect(repo.getProjectAdmissionConfig).toHaveBeenCalledWith("project-1");
    expect(repo.getPublicProjectForRecording).not.toHaveBeenCalled();
    expect(repo.createApplication).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "direct_invite",
      status: "submitted",
      invitedBy: staffActor.userId,
    });
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        streamerId: "streamer-1",
        uploadedBy: staffActor.userId,
      }),
    );
    expect(result.recording.uploadedBy).toBe(staffActor.userId);
  });

  it("rejects staff proxy delivery to a project outside the actor organization", async () => {
    const repo = baseRepo();
    repo.getProjectAdmissionConfig.mockResolvedValue({
      id: "project-2",
      name: "Other Organization Project",
      organizationId: "org-2",
      status: "recruiting",
      openSignup: false,
      allowDirectInvite: true,
      forceRecording: true,
      defaultSettlementMethod: "manual",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultSettlementRule: {},
    });

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: staffActor,
        input: {
          projectId: "project-2",
          streamerId: "streamer-1",
          link: "https://videos.example.com/cross-org-proxy",
        },
      }),
    ).rejects.toThrow("Project is not available for recording delivery");

    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("rejects staff proxy delivery to a blocked own-organization project", async () => {
    const repo = baseRepo();
    repo.getProjectAdmissionConfig.mockResolvedValue({
      id: "project-1",
      name: "Closed Project",
      organizationId: "org-1",
      status: "closed",
      openSignup: false,
      allowDirectInvite: true,
      forceRecording: true,
      defaultSettlementMethod: "manual",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultSettlementRule: {},
    });

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: staffActor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/closed-project-proxy",
        },
      }),
    ).rejects.toThrow("Project is not available for recording delivery");

    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("rejects finance project recording proxy uploads", async () => {
    const repo = baseRepo();

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: { ...staffActor, role: "finance" as const },
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/finance-proxy",
        },
      }),
    ).rejects.toThrow("Current role cannot submit project recordings");

    expect(repo.getProjectAdmissionConfig).not.toHaveBeenCalled();
    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("never lets staff proxy-upload for a blacklisted streamer", async () => {
    const repo = baseRepo();
    repo.getStreamerForAdmission.mockResolvedValue({
      id: "streamer-1",
      displayName: "Blocked Streamer",
      riskLevel: "blacklisted",
    });

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: staffActor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          link: "https://videos.example.com/blocked-proxy",
        },
      }),
    ).rejects.toThrow("Blacklisted streamers cannot submit project recordings");

    expect(repo.createApplication).not.toHaveBeenCalled();
    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
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
        },
      }),
    ).rejects.toThrow("Project is not available for recording delivery");
  });
});
