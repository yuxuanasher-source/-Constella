import { describe, expect, it, vi } from "vitest";

import { SupabaseApplicationRepository } from "./application-repository";

describe("SupabaseApplicationRepository", () => {
  it("reads organization and status for staff project recording delivery", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "project-1",
        name: "Private Project",
        organization_id: "org-1",
        status: "recruiting",
        open_signup: false,
        allow_direct_invite: true,
        force_recording: true,
        default_settlement_method: "manual",
        default_hourly_rate: 0,
        default_base_salary: 0,
        default_settlement_rule: {},
      },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repo = new SupabaseApplicationRepository({ from } as never);

    await expect(repo.getProjectAdmissionConfig("project-1")).resolves.toEqual(
      expect.objectContaining({
        id: "project-1",
        organizationId: "org-1",
        status: "recruiting",
        openSignup: false,
      }),
    );
    expect(from).toHaveBeenCalledWith("projects");
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("organization_id, status"),
    );
  });

  it("reads public project recording metadata from the streamer announcement view", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "project-1",
        name: "Public Project",
        organization_id: "org-1",
        status: "recruiting",
      },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const repo = new SupabaseApplicationRepository({ from } as never);

    await expect(
      repo.getPublicProjectForRecording("project-1"),
    ).resolves.toEqual({
      id: "project-1",
      name: "Public Project",
      organizationId: "org-1",
      status: "recruiting",
      isPublicToStreamers: true,
    });
    expect(from).toHaveBeenCalledWith("streamer_public_project_announcements");
    expect(select).toHaveBeenCalledWith("id, name, organization_id, status");
    expect(eq).toHaveBeenCalledWith("id", "project-1");
  });

  it("persists normalized recording self-check metadata on submission", async () => {
    const single = vi.fn(async () => ({
      data: {
        id: "recording-1",
        application_id: "application-1",
        version: 1,
        status: "submitted",
        uploaded_by: "user-streamer",
        collaboration_id: null,
        contributor_organization_id: null,
        self_score_total: 42,
        self_assessment_level: "L0",
      },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const repo = new SupabaseApplicationRepository({ from } as never);
    const dimensionScores = {
      product_understanding: 8,
      expression_control: 8,
      content_structure: 7,
      interaction_design: 7,
      commercial_task: 6,
      technical_compliance: 6,
    };
    const keyMoments = [
      { key: "best_performance" as const, startSeconds: 10, endSeconds: 20 },
      { key: "selling_point" as const, startSeconds: 30, endSeconds: 45 },
      { key: "commercial_task" as const, startSeconds: 50, endSeconds: 70 },
    ];

    const result = await repo.createRecordingSubmission({
      organizationId: "org-1",
      applicationId: "application-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      uploadedBy: "user-streamer",
      version: 1,
      externalUrl: "https://videos.example.com/low-self-score",
      selfCheck: {
        readConfirmed: true,
        dimensionScores,
        totalScore: 42,
        selfLevel: "L0",
        keyMoments,
        note: "Self score is low; please give revision advice.",
      },
    });

    expect(from).toHaveBeenCalledWith("recording_submissions");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        task_card_read_confirmed_at: expect.any(String),
        self_check: dimensionScores,
        key_moments: keyMoments,
        self_score_total: 42,
        self_assessment_level: "L0",
        submitter_note: "Self score is low; please give revision advice.",
      }),
    );
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("self_score_total"),
    );
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("self_assessment_level"),
    );
    expect(result).toMatchObject({
      uploadedBy: "user-streamer",
      selfScoreTotal: 42,
      selfAssessmentLevel: "L0",
    });
  });

  it("persists and returns the user who uploaded a recording submission", async () => {
    const single = vi.fn(async () => ({
      data: {
        id: "recording-1",
        application_id: "application-1",
        version: 2,
        status: "submitted",
        uploaded_by: "user-ops",
        collaboration_id: null,
        contributor_organization_id: null,
        self_score_total: null,
        self_assessment_level: null,
      },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const repo = new SupabaseApplicationRepository({ from } as never);

    await expect(
      repo.createRecordingSubmission({
        organizationId: "org-1",
        applicationId: "application-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        uploadedBy: "user-ops",
        version: 2,
        externalUrl: "https://videos.example.com/proxy-upload",
      }),
    ).resolves.toEqual({
      id: "recording-1",
      applicationId: "application-1",
      version: 2,
      status: "submitted",
      uploadedBy: "user-ops",
      collaborationId: null,
      contributorOrganizationId: null,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ uploaded_by: "user-ops" }),
    );
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("uploaded_by"),
    );
  });
});
