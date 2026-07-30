import { describe, expect, it, vi } from "vitest";

import {
  applyToProject,
  confirmApplicationJoin,
  inviteStreamerToProject,
  rejectApplicationJoin,
  reviewRecordingSubmission,
  submitRecording,
  type ApplicationRecord,
  type ApplicationRepository,
  type RecordingSubmissionRecord,
} from "./application-service";

const staffActor = {
  userId: "22222222-2222-2222-2222-222222222222",
  name: "Ops Manager",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const operatorActor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "Business Operator",
  role: "operator_business" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const ownerActor = {
  userId: "11111111-1111-1111-1111-111111111111",
  name: "Owner",
  role: "owner" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const financeActor = {
  userId: "44444444-4444-4444-4444-444444444444",
  name: "Finance",
  role: "finance" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const streamerActor = {
  userId: "55555555-5555-5555-5555-555555555555",
  name: "Streamer One",
  role: "streamer" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  streamerId: "streamer-1",
};

const baseApplication: ApplicationRecord = {
  id: "app-1",
  organizationId: staffActor.organizationId,
  projectId: "project-1",
  streamerId: "streamer-1",
  source: "signup",
  status: "submitted",
};

function makeRepo(
  overrides: Partial<ApplicationRepository> = {},
): ApplicationRepository {
  return {
    getProjectAdmissionConfig: vi.fn().mockResolvedValue({
      id: "project-1",
      name: "Launch Project",
      openSignup: true,
      allowDirectInvite: true,
      forceRecording: true,
      defaultSettlementMethod: "cpt",
      defaultHourlyRate: 80,
      defaultBaseSalary: 0,
      defaultSettlementRule: { method: "cpt", hourly_rate: 80 },
    }),
    getStreamerForAdmission: vi.fn().mockResolvedValue({
      id: "streamer-1",
      displayName: "Streamer One",
      userId: streamerActor.userId,
      organizationId: streamerActor.organizationId,
      riskLevel: "low",
      defaultSettlementMethod: "manual",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 0,
    }),
    getApplicationById: vi.fn().mockResolvedValue(baseApplication),
    getApplicationByProjectAndStreamer: vi.fn().mockResolvedValue(null),
    getActiveCollaborationAgreement: vi.fn().mockResolvedValue(null),
    markApplicationRecordingReviewing: vi.fn().mockImplementation((id) =>
      Promise.resolve({
        ...baseApplication,
        id,
        status: "recording_reviewing",
      }),
    ),
    createApplication: vi.fn().mockResolvedValue(baseApplication),
    updateApplicationStatus: vi.fn().mockImplementation((id, patch) =>
      Promise.resolve({
        ...baseApplication,
        id,
        status: patch.status,
        decisionReason: patch.decisionReason,
      }),
    ),
    createRecordingSubmission: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "app-1",
      version: 1,
      status: "submitted",
      uploadedBy: streamerActor.userId,
    }),
    getLatestRecordingSubmission: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "app-1",
      version: 1,
      status: "submitted",
    }),
    updateRecordingReview: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "app-1",
      version: 1,
      status: "approved",
    }),
    createProjectStreamer: vi.fn().mockResolvedValue({
      id: "project-streamer-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "joined",
    }),
    ...overrides,
  };
}

describe("application service", () => {
  it("lets a streamer apply to an open project and notifies staff", async () => {
    const repo = makeRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await applyToProject({
      repo,
      audit,
      notify,
      actor: streamerActor,
      input: { projectId: "project-1", streamerId: "streamer-1" },
    });

    expect(repo.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ source: "signup", status: "submitted" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", objectType: "application" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: "operator_business" }),
    );
  });

  it("reuses an existing application when the streamer already signed up", async () => {
    const existingApplication = {
      ...baseApplication,
      id: "app-existing-signup",
      status: "recording_reviewing" as const,
    };
    const repo = makeRepo({
      getApplicationByProjectAndStreamer: vi
        .fn()
        .mockResolvedValue(existingApplication),
    });
    const audit = vi.fn();
    const notify = vi.fn();

    const application = await applyToProject({
      repo,
      audit,
      notify,
      actor: streamerActor,
      input: { projectId: "project-1", streamerId: "streamer-1" },
    });

    expect(application).toEqual(existingApplication);
    expect(repo.createApplication).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("falls back to the streamer-visible announcement when the project row is hidden", async () => {
    const repo = makeRepo({
      getProjectAdmissionConfig: vi.fn().mockResolvedValue(null),
    });
    const getPublicProjectForRecording = vi.fn().mockResolvedValue({
      id: "project-public-1",
      name: "Public Signup Project",
      organizationId: streamerActor.organizationId,
      status: "recruiting",
      isPublicToStreamers: true,
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await applyToProject({
      repo: { ...repo, getPublicProjectForRecording },
      audit,
      notify,
      actor: streamerActor,
      input: { projectId: "project-public-1", streamerId: "streamer-1" },
    });

    expect(getPublicProjectForRecording).toHaveBeenCalledWith(
      "project-public-1",
    );
    expect(repo.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-public-1",
        streamerId: "streamer-1",
        source: "signup",
        status: "submitted",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", objectType: "application" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: "operator_business" }),
    );
  });

  it("rejects self signup when the hidden project is not visible to the streamer", async () => {
    const repo = makeRepo({
      getProjectAdmissionConfig: vi.fn().mockResolvedValue(null),
    });

    await expect(
      applyToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: { projectId: "project-hidden", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Project not found");

    await expect(
      applyToProject({
        repo: {
          ...repo,
          getPublicProjectForRecording: vi.fn().mockResolvedValue({
            id: "project-hidden",
            name: "Other Org Project",
            organizationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            status: "recruiting",
            isPublicToStreamers: true,
          }),
        },
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: { projectId: "project-hidden", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Project not found");

    await expect(
      applyToProject({
        repo: {
          ...repo,
          getPublicProjectForRecording: vi.fn().mockResolvedValue({
            id: "project-hidden",
            name: "Ended Project",
            organizationId: streamerActor.organizationId,
            status: "ended",
            isPublicToStreamers: true,
          }),
        },
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: { projectId: "project-hidden", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Project not found");

    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("still blocks signup when the readable project has closed signup", async () => {
    const repo = makeRepo({
      getProjectAdmissionConfig: vi.fn().mockResolvedValue({
        id: "project-1",
        name: "Closed Project",
        openSignup: false,
        allowDirectInvite: true,
        forceRecording: true,
        defaultSettlementMethod: "cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 0,
        defaultSettlementRule: { method: "cpt", hourly_rate: 80 },
      }),
    });

    await expect(
      applyToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: { projectId: "project-1", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Project is not open for signup");
    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("blocks invitations for blacklisted streamers", async () => {
    const repo = makeRepo({
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        riskLevel: "blacklisted",
      }),
    });

    await expect(
      inviteStreamerToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: { projectId: "project-1", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Blacklisted streamers cannot be invited");
  });

  it("reuses an existing invitation for the same project streamer pair", async () => {
    const existingApplication = {
      ...baseApplication,
      id: "app-existing-invite",
      source: "direct_invite" as const,
      status: "invited" as const,
    };
    const repo = makeRepo({
      getApplicationByProjectAndStreamer: vi
        .fn()
        .mockResolvedValue(existingApplication),
    });
    const audit = vi.fn();
    const notify = vi.fn();

    const application = await inviteStreamerToProject({
      repo,
      audit,
      notify,
      actor: operatorActor,
      input: { projectId: "project-1", streamerId: "streamer-1" },
    });

    expect(application).toEqual(existingApplication);
    expect(repo.createApplication).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("creates partner collaboration applications with contributor attribution", async () => {
    const partnerActor = {
      ...operatorActor,
      userId: "partner-user",
      organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const repo = makeRepo({
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        organizationId: partnerActor.organizationId,
        riskLevel: "low",
      }),
      getActiveCollaborationAgreement: vi.fn().mockResolvedValue({
        id: "collaboration-1",
        projectId: "project-1",
        partnerOrganizationId: partnerActor.organizationId,
        status: "active",
      }),
    });

    await inviteStreamerToProject({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: partnerActor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        collaborationId: "collaboration-1",
      },
    });

    expect(repo.getActiveCollaborationAgreement).toHaveBeenCalledWith({
      projectId: "project-1",
      collaborationId: "collaboration-1",
      contributorOrganizationId: partnerActor.organizationId,
    });
    expect(repo.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: partnerActor.organizationId,
        collaborationId: "collaboration-1",
        contributorOrganizationId: partnerActor.organizationId,
      }),
    );
  });

  it("rejects partner invitations when the streamer is not in the partner organization", async () => {
    const partnerActor = {
      ...operatorActor,
      userId: "partner-user",
      organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const repo = makeRepo({
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        organizationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        riskLevel: "low",
      }),
      getActiveCollaborationAgreement: vi.fn().mockResolvedValue({
        id: "collaboration-1",
        projectId: "project-1",
        partnerOrganizationId: partnerActor.organizationId,
        status: "active",
      }),
    });

    await expect(
      inviteStreamerToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: partnerActor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          collaborationId: "collaboration-1",
        },
      }),
    ).rejects.toThrow(/partner organization/);
    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("blocks collaboration applications without an active agreement", async () => {
    const repo = makeRepo({
      getActiveCollaborationAgreement: vi.fn().mockResolvedValue(null),
    });

    await expect(
      inviteStreamerToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          collaborationId: "collaboration-1",
        },
      }),
    ).rejects.toThrow("Active collaboration agreement is required");
    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("still blocks reusing an invitation when the streamer is now blacklisted", async () => {
    const repo = makeRepo({
      getApplicationByProjectAndStreamer: vi.fn().mockResolvedValue({
        ...baseApplication,
        id: "app-existing-invite",
        source: "direct_invite" as const,
        status: "invited" as const,
      }),
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        riskLevel: "blacklisted",
      }),
    });

    await expect(
      inviteStreamerToProject({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: { projectId: "project-1", streamerId: "streamer-1" },
      }),
    ).rejects.toThrow("Blacklisted streamers cannot be invited");
    expect(repo.createApplication).not.toHaveBeenCalled();
  });

  it("submits a new recording version and moves the application to review", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await submitRecording({
      repo,
      audit,
      notify,
      actor: streamerActor,
      input: {
        applicationId: "app-1",
        storagePath:
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recordings/project-1/video.mp4",
        durationSeconds: 3600,
      },
    });

    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        uploadedBy: streamerActor.userId,
        storagePath:
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recordings/project-1/video.mp4",
      }),
    );
    expect(repo.markApplicationRecordingReviewing).toHaveBeenCalledWith(
      "app-1",
    );
    expect(repo.updateApplicationStatus).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: "operator_business",
        content: expect.stringContaining("submitted their screening recording"),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: streamerActor.userId,
        streamerId: "streamer-1",
        after: expect.objectContaining({
          uploadedBy: streamerActor.userId,
          uploadMode: "self",
        }),
        changedFields: expect.arrayContaining(["uploaded_by", "upload_mode"]),
      }),
    );
  });

  it.each([
    ["owner", ownerActor],
    ["ops_manager", staffActor],
    ["operator_business", operatorActor],
  ] as const)(
    "allows %s to proxy-upload for an application in the actor organization",
    async (_role, actor) => {
      const repo = makeRepo({
        getApplicationById: vi.fn().mockResolvedValue({
          ...baseApplication,
          status: "recording_required",
        }),
      });
      const audit = vi.fn().mockResolvedValue(undefined);
      const notify = vi.fn().mockResolvedValue(undefined);

      await submitRecording({
        repo,
        audit,
        notify,
        actor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/proxy-upload",
        },
      });

      expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
        expect.objectContaining({
          streamerId: "streamer-1",
          uploadedBy: actor.userId,
          externalUrl: "https://videos.example.com/proxy-upload",
        }),
      );
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: actor.userId,
          actorRole: actor.role,
          streamerId: "streamer-1",
          after: expect.objectContaining({
            uploadedBy: actor.userId,
            uploadMode: "proxy",
          }),
          changedFields: expect.arrayContaining(["uploaded_by", "upload_mode"]),
        }),
      );
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("proxy-uploaded"),
        }),
      );
    },
  );

  it("rejects finance proxy uploads", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: financeActor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/finance-upload",
        },
      }),
    ).rejects.toThrow("Current role cannot submit screening recordings");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects staff proxy uploads for applications outside the actor organization", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/cross-org",
        },
      }),
    ).rejects.toThrow("Cross-organization access is not allowed");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("allows an authorized contributor organization to proxy-upload", async () => {
    const contributorActor = {
      ...operatorActor,
      organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
        collaborationId: "collaboration-1",
        contributorOrganizationId: contributorActor.organizationId,
      }),
      getActiveCollaborationAgreement: vi.fn().mockResolvedValue({
        id: "collaboration-1",
        projectId: "project-1",
        partnerOrganizationId: contributorActor.organizationId,
        status: "active",
      }),
    });

    await submitRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: contributorActor,
      input: {
        applicationId: "app-1",
        externalUrl: "https://videos.example.com/contributor-proxy",
      },
    });

    expect(repo.getActiveCollaborationAgreement).toHaveBeenCalledWith({
      projectId: "project-1",
      collaborationId: "collaboration-1",
      contributorOrganizationId: contributorActor.organizationId,
    });
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: contributorActor.organizationId,
        uploadedBy: contributorActor.userId,
      }),
    );
  });

  it("rejects contributor proxy upload when the collaboration agreement is not active", async () => {
    const contributorActor = {
      ...operatorActor,
      organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
        collaborationId: "collaboration-1",
        contributorOrganizationId: contributorActor.organizationId,
      }),
      getActiveCollaborationAgreement: vi.fn().mockResolvedValue(null),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: contributorActor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/inactive-contributor",
        },
      }),
    ).rejects.toThrow("Cross-organization access is not allowed");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it("rejects proxy uploads for a blacklisted subject streamer", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Blocked Streamer",
        riskLevel: "blacklisted",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/blocked-proxy",
        },
      }),
    ).rejects.toThrow("Blacklisted streamers cannot submit");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  });

  it.each([
    "ftp://videos.example.com/not-http",
    "javascript:alert(1)",
    "not-a-url",
  ])(
    "rejects a non-http(s) external recording URL: %s",
    async (externalUrl) => {
      const repo = makeRepo({
        getApplicationById: vi.fn().mockResolvedValue({
          ...baseApplication,
          status: "recording_required",
        }),
      });

      await expect(
        submitRecording({
          repo,
          audit: vi.fn(),
          notify: vi.fn(),
          actor: streamerActor,
          input: { applicationId: "app-1", externalUrl },
        }),
      ).rejects.toThrow("Recording link must be an http(s) URL");

      expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    },
  );

  it("rejects streamer recording submissions for another streamer's application", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        streamerId: "streamer-2",
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn().mockResolvedValue(undefined),
        actor: streamerActor,
        input: {
          applicationId: "app-1",
          externalUrl: "https://videos.example.com/other-streamer",
        },
      }),
    ).rejects.toThrow("Application is not available for the current streamer");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    expect(repo.markApplicationRecordingReviewing).not.toHaveBeenCalled();
  });

  it("rejects cross-organization storage paths before persistence", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: {
          applicationId: "app-1",
          storagePath: "other-org/recordings/project-1/video.mp4",
          externalUrl: "https://videos.example.com/submission",
        },
      }),
    ).rejects.toThrow("Invalid recording storage path");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    expect(repo.markApplicationRecordingReviewing).not.toHaveBeenCalled();
  });

  it("rejects storage path traversal before persistence", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: {
          applicationId: "app-1",
          storagePath:
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/recordings/..\\other/video.mp4",
        },
      }),
    ).rejects.toThrow("Invalid recording storage path");

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    expect(repo.markApplicationRecordingReviewing).not.toHaveBeenCalled();
  });

  it("rejects a blank storage path without an external URL before persistence", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
      }),
    });

    await expect(
      submitRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: streamerActor,
        input: {
          applicationId: "app-1",
          storagePath: "   ",
        },
      }),
    ).rejects.toThrow(
      "Recording submission requires a storage path or external URL",
    );

    expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
    expect(repo.markApplicationRecordingReviewing).not.toHaveBeenCalled();
  });

  it("copies application collaboration attribution onto recording submissions", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_required",
        collaborationId: "collaboration-1",
        contributorOrganizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    });

    await submitRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: streamerActor,
      input: {
        applicationId: "app-1",
        externalUrl: "https://videos.example.com/collab-recording",
      },
    });

    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationId: "collaboration-1",
        contributorOrganizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    );
  });

  it("approves a recording without joining the streamer to the project", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
    });

    await reviewRecordingSubmission({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: operatorActor,
      input: {
        applicationId: "app-1",
        decision: "approved",
        note: "Recording meets the project gate.",
      },
    });

    expect(repo.updateApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({ status: "recording_approved" }),
    );
    expect(repo.updateRecordingReview).toHaveBeenCalledWith("recording-1", {
      status: "approved",
      reviewedBy: operatorActor.userId,
      reviewedAt: expect.any(String),
      reviewNote: "Recording meets the project gate.",
      mcnReviewDecision: "approved",
      mcnReviewedBy: operatorActor.userId,
      mcnReviewedAt: expect.any(String),
      mcnReviewNote: "Recording meets the project gate.",
    });
    expect(repo.createProjectStreamer).not.toHaveBeenCalled();
  });

  it("resumes an interrupted review from the frozen MCN fact without rewriting it", async () => {
    let latest: RecordingSubmissionRecord = {
      id: "recording-1",
      applicationId: "app-1",
      version: 1,
      status: "submitted",
      uploadedBy: streamerActor.userId,
      mcnReviewDecision: null,
      mcnReviewedBy: null,
      mcnReviewedAt: null,
      mcnReviewNote: null,
    };
    const updateRecordingReview = vi.fn(
      async (
        _recordingId: string,
        patch: Parameters<ApplicationRepository["updateRecordingReview"]>[1],
      ) => {
        latest = {
          ...latest,
          status: patch.status,
          mcnReviewDecision: patch.mcnReviewDecision,
          mcnReviewedBy: patch.mcnReviewedBy,
          mcnReviewedAt: patch.mcnReviewedAt,
          mcnReviewNote: patch.mcnReviewNote ?? null,
        };
        return latest;
      },
    );
    const updateApplicationStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("application update interrupted"))
      .mockImplementation(async (applicationId, patch) => ({
        ...baseApplication,
        id: applicationId,
        status: patch.status,
        decisionReason: patch.decisionReason,
      }));
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
      getLatestRecordingSubmission: vi.fn(async () => latest),
      updateRecordingReview,
      updateApplicationStatus,
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const recordEvaluation = vi.fn().mockResolvedValue(undefined);

    await expect(
      reviewRecordingSubmission({
        repo,
        audit,
        notify: vi.fn().mockResolvedValue(undefined),
        actor: operatorActor,
        input: {
          applicationId: "app-1",
          decision: "approved",
          note: "Original frozen note",
        },
        recordEvaluation,
      }),
    ).rejects.toThrow("application update interrupted");
    const frozenReviewedAt = latest.mcnReviewedAt;

    await expect(
      reviewRecordingSubmission({
        repo,
        audit,
        notify: vi.fn().mockResolvedValue(undefined),
        actor: operatorActor,
        input: {
          applicationId: "app-1",
          decision: "approved",
          note: "Contradictory retry note",
        },
        recordEvaluation,
      }),
    ).resolves.toMatchObject({ status: "recording_approved" });

    expect(updateRecordingReview).toHaveBeenCalledTimes(1);
    expect(updateApplicationStatus).toHaveBeenLastCalledWith("app-1", {
      status: "recording_approved",
      decidedBy: operatorActor.userId,
      decidedAt: frozenReviewedAt,
      decisionReason: "Original frozen note",
    });
    expect(recordEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
        reviewerId: operatorActor.userId,
        note: "Original frozen note",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Original frozen note" }),
    );
  });

  it("rejects a retry that conflicts with an immutable MCN decision", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
      getLatestRecordingSubmission: vi.fn().mockResolvedValue({
        id: "recording-1",
        applicationId: "app-1",
        version: 1,
        status: "approved",
        uploadedBy: streamerActor.userId,
        mcnReviewDecision: "approved",
        mcnReviewedBy: operatorActor.userId,
        mcnReviewedAt: "2026-07-30T08:00:00.000Z",
        mcnReviewNote: "Original frozen note",
      }),
    });

    await expect(
      reviewRecordingSubmission({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: {
          applicationId: "app-1",
          decision: "needs_changes",
          note: "Try to reverse the frozen decision",
        },
      }),
    ).rejects.toThrow(
      "Recording MCN review is already frozen as approved and cannot change to needs_changes",
    );
    expect(repo.updateRecordingReview).not.toHaveBeenCalled();
    expect(repo.updateApplicationStatus).not.toHaveBeenCalled();
  });

  it("rejects a review that gives neither reason codes nor a note", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
    });

    await expect(
      reviewRecordingSubmission({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: { applicationId: "app-1", decision: "rejected" },
      }),
    ).rejects.toThrow(/requires reason codes or a note/);
    expect(repo.updateRecordingReview).not.toHaveBeenCalled();
  });

  it("records an admission evaluation with reason codes when a recorder is wired", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
    });
    const recordEvaluation = vi.fn().mockResolvedValue(undefined);

    await reviewRecordingSubmission({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: operatorActor,
      input: {
        applicationId: "app-1",
        decision: "rejected",
        note: "话术不贴卖点",
        reasonCodes: ["script_fit"],
      },
      recordEvaluation,
    });

    expect(recordEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-1",
        decision: "rejected",
        reviewerId: operatorActor.userId,
        noteSource: "human",
        reasonCodes: ["script_fit"],
      }),
    );
  });

  it("forwards checkpoint structured feedback as evidence without changing the human decision", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
    });
    const recordEvaluation = vi.fn().mockResolvedValue(undefined);

    await reviewRecordingSubmission({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: operatorActor,
      input: {
        applicationId: "app-1",
        decision: "needs_changes",
        note: "人工建议补充",
        reasonCodes: ["script_fit"],
        checkpointResults: [
          {
            checkpointKey: "script_fit",
            verdict: "fail",
            note: "缺少开服冲榜卖点",
            evidence: {
              structuredFeedback: {
                issue: "卖点没说清",
                howToImprove: "补充福利入口和预约动作",
                rerecordSuggestion: "clip",
                advisoryOnly: true,
              },
            },
          },
        ],
      },
      recordEvaluation,
    });

    expect(repo.updateApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({ status: "recording_required" }),
    );
    expect(recordEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "needs_changes",
        checkpointResults: [
          {
            checkpointKey: "script_fit",
            verdict: "fail",
            note: "缺少开服冲榜卖点",
            evidence: {
              structuredFeedback: {
                issue: "卖点没说清",
                howToImprove: "补充福利入口和预约动作",
                rerecordSuggestion: "clip",
                advisoryOnly: true,
              },
            },
          },
        ],
      }),
    );
  });

  it("marks legacy note-only rejections for later classification", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_reviewing",
      }),
    });
    const recordEvaluation = vi.fn().mockResolvedValue(undefined);

    await reviewRecordingSubmission({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: operatorActor,
      input: {
        applicationId: "app-1",
        decision: "needs_changes",
        note: "开场太拖沓",
      },
      recordEvaluation,
    });

    expect(recordEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        noteSource: "needs_classification",
        reasonCodes: [],
      }),
    );
  });

  it("requires owner or ops_manager for final join confirmation", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
    });

    await expect(
      confirmApplicationJoin({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: operatorActor,
        input: { applicationId: "app-1" },
      }),
    ).rejects.toThrow("Only owner and ops_manager can confirm project join");
  });

  it("freezes the streamer default settlement rule when joining", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        riskLevel: "low",
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 0,
      }),
    });

    await confirmApplicationJoin({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: { applicationId: "app-1" },
    });

    expect(repo.createProjectStreamer).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementMethod: "base_salary_cpt",
        hourlyRate: 80,
        baseSalary: 6000,
        cpsRateBps: 0,
        settlementRule: expect.objectContaining({
          source: "streamer_default",
          settlementMethod: "base_salary_cpt",
          cptHourlyRate: 80,
          baseSalary: 6000,
          cpsRateBps: 0,
        }),
      }),
    );
  });

  it("applies the operator settlement override at confirm time", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
      getStreamerForAdmission: vi.fn().mockResolvedValue({
        id: "streamer-1",
        displayName: "Streamer One",
        userId: streamerActor.userId,
        riskLevel: "low",
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 0,
      }),
    });

    await confirmApplicationJoin({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: {
        applicationId: "app-1",
        settlement: {
          settlementMethod: "cps",
          hourlyRate: 0,
          baseSalary: 2000,
          cpsRateBps: 1200,
        },
      },
    });

    expect(repo.createProjectStreamer).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementMethod: "cps",
        hourlyRate: 0,
        baseSalary: 2000,
        cpsRateBps: 1200,
        settlementRule: expect.objectContaining({
          source: "operator_confirm",
          settlementMethod: "cps",
          baseSalary: 2000,
          cpsRateBps: 1200,
        }),
      }),
    );
  });

  it("rejects invalid operator settlement overrides at confirm time", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
    });

    await expect(
      confirmApplicationJoin({
        repo,
        audit: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn().mockResolvedValue(undefined),
        actor: staffActor,
        input: {
          applicationId: "app-1",
          settlement: { settlementMethod: "bogus" },
        },
      }),
    ).rejects.toThrow("Invalid settlement method");

    await expect(
      confirmApplicationJoin({
        repo,
        audit: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn().mockResolvedValue(undefined),
        actor: staffActor,
        input: {
          applicationId: "app-1",
          settlement: { settlementMethod: "cps", cpsRateBps: 20000 },
        },
      }),
    ).rejects.toThrow("cpsRateBps cannot exceed 10000");
  });

  it("copies application collaboration attribution onto joined project streamers", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
        collaborationId: "collaboration-1",
        contributorOrganizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    });

    await confirmApplicationJoin({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: { applicationId: "app-1" },
    });

    expect(repo.createProjectStreamer).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationId: "collaboration-1",
        contributorOrganizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    );
  });

  it("falls back to project settlement rule when streamer default is unconfigured", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
    });
    const audit = vi.fn().mockResolvedValue(undefined);

    await confirmApplicationJoin({
      repo,
      audit,
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: { applicationId: "app-1" },
    });

    expect(repo.createProjectStreamer).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementMethod: "cpt",
        hourlyRate: 80,
        baseSalary: 0,
        cpsRateBps: 0,
        settlementRule: expect.objectContaining({
          source: "project_default",
          settlementMethod: "cpt",
          cptHourlyRate: 80,
          baseSalary: 0,
          cpsRateBps: 0,
        }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve", objectType: "application" }),
    );
  });

  it("confirms a direct invitation as a joined project streamer", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        source: "direct_invite",
        status: "invited",
      }),
    });

    await confirmApplicationJoin({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: { applicationId: "app-1" },
    });

    expect(repo.createProjectStreamer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "joined",
      }),
    );
    expect(repo.updateApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({ status: "joined" }),
    );
  });

  it("records a not-joined reason during final rejection", async () => {
    const repo = makeRepo({
      getApplicationById: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: "recording_approved",
      }),
    });

    await rejectApplicationJoin({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: staffActor,
      input: {
        applicationId: "app-1",
        reason: "quota_full",
      },
    });

    expect(repo.updateApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({
        status: "declined",
        decisionReason: "quota_full",
      }),
    );
  });
});
