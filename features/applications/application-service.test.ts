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
        storagePath: "org/applications/app-1/video.mp4",
        durationSeconds: 3600,
      },
    });

    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2 }),
    );
    expect(repo.markApplicationRecordingReviewing).toHaveBeenCalledWith(
      "app-1",
    );
    expect(repo.updateApplicationStatus).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: "operator_business" }),
    );
  });

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
    expect(repo.createProjectStreamer).not.toHaveBeenCalled();
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
