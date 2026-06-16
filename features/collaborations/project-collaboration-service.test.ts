import { describe, expect, it } from "vitest";

import {
  confirmProjectCollaborationCounter,
  createProjectCollaborationShare,
  getPublicProjectCollaboration,
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
  reviewProjectCollaborationApplication,
  submitProjectCollaborationApplication,
  submitProjectCollaborationInviteApplication,
  type CollaborationAgreementRecord,
  type CollaborationApplicationRecord,
  type CollaborationProjectRecord,
  type CollaborationShareRecord,
  type ProjectCollaborationRepository,
} from "./project-collaboration-service";

const ownerActor = {
  userId: "user-owner",
  name: "Owner",
  role: "ops_manager" as const,
  organizationId: "org-owner",
};

const partnerActor = {
  userId: "user-partner",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
};

describe("project collaboration service", () => {
  it("creates an active share only for an open owner project and returns the raw token once", async () => {
    const repo = new MemoryCollaborationRepository([
      openProject(),
      {
        ...openProject(),
        id: "closed-project",
        isOpenToMcnCollaboration: false,
      },
    ]);

    const result = await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: {},
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "raw-token",
    });

    expect(result.token).toBe("raw-token");
    expect(result.share).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        status: "active",
        expiresAt: "2026-06-24T00:00:00.000Z",
      }),
    );
    expect(repo.shares[0].tokenHash).not.toBe("raw-token");

    await expect(
      createProjectCollaborationShare({
        repo,
        actor: ownerActor,
        projectId: "closed-project",
        input: {},
      }),
    ).rejects.toThrow("Project is not open to MCN collaboration");
  });

  it("generates a fresh share token even when an older active link exists", async () => {
    const repo = new MemoryCollaborationRepository([openProject()]);
    const first = await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: {},
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "first-token",
    });

    const second = await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: {},
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "second-token",
    });

    expect(first.token).toBe("first-token");
    expect(second.token).toBe("second-token");
    expect(repo.shares).toHaveLength(2);
    expect(repo.shares.map((share) => share.status)).toEqual([
      "active",
      "active",
    ]);
    expect(repo.shares[0].tokenHash).not.toBe(repo.shares[1].tokenHash);
  });

  it("submits an invite-link application without activating an agreement", async () => {
    const repo = new MemoryCollaborationRepository([openProject()]);
    await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: {},
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "raw-token",
    });

    const result = await submitProjectCollaborationInviteApplication({
      repo,
      actor: partnerActor,
      input: {
        inviteLink:
          "http://localhost:3000/share/project-collaboration/raw-token",
        requestedRevenueShareBps: 900,
        applicantNote: "We can bring verified streamers.",
      },
      now: "2026-06-11T00:00:00.000Z",
    });

    expect(result).toEqual({
      application: expect.objectContaining({
        projectId: "project-1",
        applicantOrganizationId: "org-partner",
        status: "submitted",
        requestedRevenueShareBps: 900,
        finalRevenueShareBps: null,
      }),
      project: expect.objectContaining({ id: "project-1" }),
      pendingOwnerReview: true,
    });
    expect(repo.agreements).toHaveLength(0);
  });

  it("returns a public snapshot without token hashes or private project fields", async () => {
    const repo = new MemoryCollaborationRepository([openProject()]);
    await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: {},
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "raw-token",
    });

    const result = await getPublicProjectCollaboration({
      repo,
      token: "raw-token",
      now: "2026-06-11T00:00:00.000Z",
    });

    expect(result).toEqual({
      available: true,
      share: {
        id: "share-1",
        status: "active",
        expiresAt: "2026-06-24T00:00:00.000Z",
        allowApplications: true,
      },
      project: {
        id: "project-1",
        name: "Owner project",
        code: "COLLAB",
        ownerOrganizationName: "Owner Org",
        collaborationSummary: "Partner MCNs can contribute.",
        collaborationTerms: { revenueShareHint: "8-12%" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("tokenHash");
    expect(JSON.stringify(result)).not.toContain("privateMargin");
  });

  it("omits summary and terms when visibleFields excludes them", async () => {
    const repo = new MemoryCollaborationRepository([openProject()]);
    await createProjectCollaborationShare({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      input: { visibleFields: ["projectName"] },
      now: "2026-06-10T00:00:00.000Z",
      tokenFactory: () => "raw-token",
    });

    const result = await getPublicProjectCollaboration({
      repo,
      token: "raw-token",
      now: "2026-06-11T00:00:00.000Z",
    });

    expect(result).toMatchObject({ available: true });
    if (result.available) {
      expect(result.project.name).toBe("Owner project");
      expect(result.project.collaborationSummary).toBe("");
      expect(result.project.collaborationTerms).toEqual({});
    }
  });

  it("rejects duplicate partner applications and owner self-applications", async () => {
    const repo = await repoWithShare();

    await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: {
        requestedRevenueShareBps: 1000,
        applicantNote: "We can bring five verified streamers.",
      },
    });

    await expect(
      submitProjectCollaborationApplication({
        repo,
        actor: partnerActor,
        token: "raw-token",
        input: { requestedRevenueShareBps: 900 },
      }),
    ).rejects.toThrow("Applicant already has a pending application");

    await expect(
      submitProjectCollaborationApplication({
        repo,
        actor: ownerActor,
        token: "raw-token",
        input: { requestedRevenueShareBps: 1000 },
      }),
    ).rejects.toThrow("Applicant organization cannot be the project owner");
  });

  it("accepts a submitted application and creates an active agreement", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1000 },
      now: "2026-06-10T00:10:00.000Z",
    });

    const firstReview = await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: { action: "accept", ownerReviewNote: "Approved" },
      now: "2026-06-10T00:20:00.000Z",
    });

    expect(firstReview.application.status).toBe("approved");
    expect(firstReview.agreement).toEqual(
      expect.objectContaining({
        status: "active",
        revenueShareBps: 1000,
        partnerOrganizationId: "org-partner",
      }),
    );
    expect(repo.agreements).toHaveLength(1);
  });

  it("refuses to accept a rejected application", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1000 },
    });
    await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: { action: "reject", rejectionReason: "Not a fit" },
    });

    await expect(
      reviewProjectCollaborationApplication({
        repo,
        actor: ownerActor,
        projectId: "project-1",
        applicationId: application.id,
        input: { action: "accept" },
      }),
    ).rejects.toThrow(/submitted/);
    expect(repo.agreements).toHaveLength(0);
  });

  it("refuses to accept an owner_countered application", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1200 },
    });
    await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: {
        action: "counter",
        ownerCounterRevenueShareBps: 900,
      },
    });

    await expect(
      reviewProjectCollaborationApplication({
        repo,
        actor: ownerActor,
        projectId: "project-1",
        applicationId: application.id,
        input: { action: "accept" },
      }),
    ).rejects.toThrow(/submitted/);
    expect(repo.agreements).toHaveLength(0);
  });

  it("counters an application and requires applicant confirmation before agreement activation", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1200 },
    });

    const countered = await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: {
        action: "counter",
        ownerCounterRevenueShareBps: 900,
        ownerReviewNote: "Counter at 9%.",
      },
    });

    expect(countered.application.status).toBe("owner_countered");
    expect(countered.agreement).toBeNull();
    expect(repo.agreements).toHaveLength(0);

    const confirmed = await confirmProjectCollaborationCounter({
      repo,
      actor: partnerActor,
      projectId: "project-1",
      applicationId: application.id,
      now: "2026-06-10T00:40:00.000Z",
    });

    expect(confirmed.application.status).toBe("approved");
    expect(confirmed.agreement).toEqual(
      expect.objectContaining({
        status: "active",
        revenueShareBps: 900,
        partnerOrganizationId: "org-partner",
      }),
    );
  });

  it("rejects counter confirmation unless the application is owner_countered", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1200 },
    });

    await expect(
      confirmProjectCollaborationCounter({
        repo,
        actor: partnerActor,
        projectId: "project-1",
        applicationId: application.id,
      }),
    ).rejects.toThrow("Application is not waiting for counter confirmation");
  });

  it("rejects counter confirmation from a non-MCN applicant role", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: { requestedRevenueShareBps: 1200 },
    });
    await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: {
        action: "counter",
        ownerCounterRevenueShareBps: 900,
      },
    });

    await expect(
      confirmProjectCollaborationCounter({
        repo,
        actor: { ...partnerActor, role: "streamer" },
        projectId: "project-1",
        applicationId: application.id,
      }),
    ).rejects.toThrow(/MCN/);
  });

  it("lists partner applications waiting for owner or applicant action", async () => {
    const repo = await repoWithShare();
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: partnerActor,
      token: "raw-token",
      input: {
        requestedRevenueShareBps: 1200,
        applicantNote: "We can join.",
      },
    });

    await reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: application.id,
      input: {
        action: "counter",
        ownerCounterRevenueShareBps: 900,
        ownerReviewNote: "Counter at 9%.",
      },
    });

    const rows = await listPartnerCollaborationApplications({
      repo,
      actor: partnerActor,
    });

    expect(rows).toEqual([
      {
        application: expect.objectContaining({
          id: application.id,
          status: "owner_countered",
          ownerCounterRevenueShareBps: 900,
        }),
        project: expect.objectContaining({
          id: "project-1",
          name: "Owner project",
        }),
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("privateMargin");
  });

  it("lists partner collaboration projects without owner private fields", async () => {
    const repo = new MemoryCollaborationRepository([openProject()]);
    repo.agreements.push({
      id: "agreement-1",
      applicationId: "application-1",
      projectId: "project-1",
      ownerOrganizationId: "org-owner",
      partnerOrganizationId: "org-partner",
      revenueShareBps: 900,
      settlementBasis: "project_revenue",
      status: "active",
      ownerConfirmedBy: "user-owner",
      ownerConfirmedAt: "2026-06-10T00:00:00.000Z",
      partnerConfirmedBy: "user-partner",
      partnerConfirmedAt: "2026-06-10T00:00:00.000Z",
      statusReason: null,
    });

    const projects = await listPartnerCollaborationProjects({
      repo,
      actor: partnerActor,
    });

    expect(projects).toEqual([
      {
        agreement: {
          id: "agreement-1",
          status: "active",
          revenueShareBps: 900,
          settlementBasis: "project_revenue",
        },
        project: {
          id: "project-1",
          name: "Owner project",
          code: "COLLAB",
          ownerOrganizationName: "Owner Org",
          collaborationSummary: "Partner MCNs can contribute.",
        },
      },
    ]);
    expect(JSON.stringify(projects)).not.toContain("privateMargin");
    expect(JSON.stringify(projects)).not.toContain("tokenHash");
  });
});

async function repoWithShare() {
  const repo = new MemoryCollaborationRepository([openProject()]);
  await createProjectCollaborationShare({
    repo,
    actor: ownerActor,
    projectId: "project-1",
    input: {},
    now: "2026-06-10T00:00:00.000Z",
    tokenFactory: () => "raw-token",
  });
  return repo;
}

function openProject(): CollaborationProjectRecord {
  return {
    id: "project-1",
    ownerOrganizationId: "org-owner",
    ownerOrganizationName: "Owner Org",
    name: "Owner project",
    code: "COLLAB",
    isOpenToMcnCollaboration: true,
    collaborationSummary: "Partner MCNs can contribute.",
    collaborationTerms: { revenueShareHint: "8-12%" },
    privateMargin: 0.4,
  };
}

class MemoryCollaborationRepository implements ProjectCollaborationRepository {
  readonly projects = new Map<string, CollaborationProjectRecord>();
  readonly shares: CollaborationShareRecord[] = [];
  readonly applications: CollaborationApplicationRecord[] = [];
  readonly agreements: CollaborationAgreementRecord[] = [];

  constructor(projects: CollaborationProjectRecord[]) {
    for (const project of projects) {
      this.projects.set(project.id, project);
    }
  }

  async getProject(projectId: string) {
    return this.projects.get(projectId) ?? null;
  }

  async listShares(projectId: string) {
    return this.shares.filter((share) => share.projectId === projectId);
  }

  async createShare(
    input: Omit<CollaborationShareRecord, "id" | "status" | "createdAt">,
  ) {
    const share: CollaborationShareRecord = {
      id: `share-${this.shares.length + 1}`,
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      ...input,
    };
    this.shares.push(share);
    return share;
  }

  async revokeShare(input: {
    shareId: string;
    projectId: string;
    revokedBy: string;
    revokedAt: string;
  }) {
    const share = this.shares.find(
      (item) => item.id === input.shareId && item.projectId === input.projectId,
    );
    if (share) {
      share.status = "revoked";
      share.revokedBy = input.revokedBy;
      share.revokedAt = input.revokedAt;
    }
  }

  async getPublicShareByTokenHash(tokenHash: string) {
    const share = this.shares.find((item) => item.tokenHash === tokenHash);
    if (!share) {
      return null;
    }
    const project = this.projects.get(share.projectId);
    return project ? { share, project } : null;
  }

  async markShareViewed() {}

  async markShareSubmitted() {}

  async findPendingApplication(
    projectId: string,
    applicantOrganizationId: string,
  ) {
    return (
      this.applications.find(
        (application) =>
          application.projectId === projectId &&
          application.applicantOrganizationId === applicantOrganizationId &&
          ["submitted", "owner_countered"].includes(application.status),
      ) ?? null
    );
  }

  async findActiveAgreement(projectId: string, partnerOrganizationId: string) {
    return (
      this.agreements.find(
        (agreement) =>
          agreement.projectId === projectId &&
          agreement.partnerOrganizationId === partnerOrganizationId &&
          agreement.status === "active",
      ) ?? null
    );
  }

  async createApplication(
    input: Omit<CollaborationApplicationRecord, "id" | "status" | "createdAt">,
  ) {
    const application: CollaborationApplicationRecord = {
      id: `application-${this.applications.length + 1}`,
      status: "submitted",
      createdAt: "2026-06-10T00:00:00.000Z",
      ...input,
    };
    this.applications.push(application);
    return application;
  }

  async listApplications(projectId: string) {
    return this.applications.filter(
      (application) => application.projectId === projectId,
    );
  }

  async listApplicationsForApplicant(applicantOrganizationId: string) {
    return this.applications
      .filter(
        (application) =>
          application.applicantOrganizationId === applicantOrganizationId &&
          ["submitted", "owner_countered"].includes(application.status),
      )
      .map((application) => ({
        application,
        project: this.projects.get(application.projectId)!,
      }));
  }

  async getApplication(applicationId: string) {
    return (
      this.applications.find(
        (application) => application.id === applicationId,
      ) ?? null
    );
  }

  async updateApplication(
    applicationId: string,
    patch: Partial<CollaborationApplicationRecord>,
  ) {
    const application = await this.getApplication(applicationId);
    if (!application) {
      throw new Error("Application not found");
    }
    Object.assign(application, patch);
    return application;
  }

  async getAgreementByApplicationId(applicationId: string) {
    return (
      this.agreements.find(
        (agreement) => agreement.applicationId === applicationId,
      ) ?? null
    );
  }

  async createAgreement(
    input: Omit<CollaborationAgreementRecord, "id" | "status" | "createdAt">,
  ) {
    const agreement: CollaborationAgreementRecord = {
      id: `agreement-${this.agreements.length + 1}`,
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      ...input,
    };
    this.agreements.push(agreement);
    return agreement;
  }

  async listCollaborationProjectsForPartner(partnerOrganizationId: string) {
    return this.agreements
      .filter(
        (agreement) =>
          agreement.partnerOrganizationId === partnerOrganizationId &&
          ["active", "suspended", "ended"].includes(agreement.status),
      )
      .map((agreement) => ({
        agreement,
        project: this.projects.get(agreement.projectId)!,
      }));
  }
}
