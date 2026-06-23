import { describe, expect, it, vi } from "vitest";

import {
  resubmitCollaborationContent,
  reviewCollaborationSubmission,
  submitCollaborationContent,
  type CollaborationLookup,
  type CollaborationSubmissionRecord,
} from "./collaboration-submission-service";

const hostActor = {
  userId: "11111111-1111-1111-1111-111111111111",
  name: "甲方运营",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const partnerActor = {
  userId: "22222222-2222-2222-2222-222222222222",
  name: "乙方运营",
  role: "ops_manager" as const,
  organizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
};

function lookup(
  overrides: Partial<CollaborationLookup> = {},
): CollaborationLookup {
  return {
    id: "C-1",
    projectId: "P-1",
    hostOrganizationId: hostActor.organizationId,
    partnerOrganizationId: partnerActor.organizationId,
    status: "active",
    ...overrides,
  };
}

function submission(
  overrides: Partial<CollaborationSubmissionRecord> = {},
): CollaborationSubmissionRecord {
  return {
    id: "S-1",
    collaborationId: "C-1",
    hostOrganizationId: hostActor.organizationId,
    partnerOrganizationId: partnerActor.organizationId,
    projectId: "P-1",
    streamerName: "小鹿",
    liveAccount: "douyin-1",
    recordingUrl: "https://rec/1",
    note: null,
    status: "submitted",
    ...overrides,
  };
}

describe("collaboration submission service", () => {
  it("lets the partner submit content on an active collaboration", async () => {
    const repo = {
      getCollaboration: vi.fn().mockResolvedValue(lookup()),
      createSubmission: vi.fn().mockResolvedValue(submission()),
    };
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await submitCollaborationContent({
      repo,
      audit,
      notify,
      actor: partnerActor,
      input: {
        collaborationId: "C-1",
        streamerName: " 小鹿 ",
        recordingUrl: "https://rec/1",
      },
    });

    expect(repo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        hostOrganizationId: hostActor.organizationId,
        partnerOrganizationId: partnerActor.organizationId,
        streamerName: "小鹿",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: hostActor.organizationId,
        type: "review",
      }),
    );
  });

  it("blocks submissions when the collaboration is not active", async () => {
    const repo = {
      getCollaboration: vi.fn().mockResolvedValue(lookup({ status: "paused" })),
      createSubmission: vi.fn(),
    };

    await expect(
      submitCollaborationContent({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: partnerActor,
        input: { collaborationId: "C-1", streamerName: "小鹿" },
      }),
    ).rejects.toThrow("Collaboration is not active");
  });

  it("blocks a different organization from submitting", async () => {
    const repo = {
      getCollaboration: vi.fn().mockResolvedValue(lookup()),
      createSubmission: vi.fn(),
    };

    await expect(
      submitCollaborationContent({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: { ...partnerActor, organizationId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
        input: { collaborationId: "C-1", streamerName: "小鹿" },
      }),
    ).rejects.toThrow("Only the partner organization can submit content");
  });

  it("only allows resubmission from needs_changes", async () => {
    const repo = {
      getSubmissionById: vi
        .fn()
        .mockResolvedValue(submission({ status: "submitted" })),
      updateSubmission: vi.fn(),
    };

    await expect(
      resubmitCollaborationContent({
        repo,
        audit: vi.fn(),
        actor: partnerActor,
        submissionId: "S-1",
        input: { recordingUrl: "https://rec/2" },
      }),
    ).rejects.toThrow("Cannot resubmit collaboration submission while it is submitted");
  });

  it("lands an approved submission into the host fulfillment chain", async () => {
    const before = submission({ status: "submitted" });
    const repo = {
      getCollaboration: vi.fn(),
      createSubmission: vi.fn(),
      getSubmissionById: vi.fn().mockResolvedValue(before),
      updateSubmission: vi.fn().mockResolvedValue(
        submission({ status: "approved", linkedStreamerId: "STR-1" }),
      ),
      landApprovedSubmission: vi
        .fn()
        .mockResolvedValue({ streamerId: "STR-1", recordingSubmissionId: "REC-1" }),
    };
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    await reviewCollaborationSubmission({
      repo,
      audit,
      notify,
      actor: hostActor,
      submissionId: "S-1",
      decision: "approved",
    });

    expect(repo.landApprovedSubmission).toHaveBeenCalledWith({
      submission: before,
      reviewerUserId: hostActor.userId,
    });
    expect(repo.updateSubmission).toHaveBeenCalledWith(
      "S-1",
      expect.objectContaining({
        status: "approved",
        linked_streamer_id: "STR-1",
        linked_recording_submission_id: "REC-1",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: partnerActor.organizationId,
        type: "review",
      }),
    );
  });

  it("blocks a non-host organization from reviewing", async () => {
    const repo = {
      getCollaboration: vi.fn(),
      createSubmission: vi.fn(),
      getSubmissionById: vi.fn().mockResolvedValue(submission()),
      updateSubmission: vi.fn(),
      landApprovedSubmission: vi.fn(),
    };

    await expect(
      reviewCollaborationSubmission({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: partnerActor,
        submissionId: "S-1",
        decision: "approved",
      }),
    ).rejects.toThrow("Only host organization staff can review submissions");
    expect(repo.landApprovedSubmission).not.toHaveBeenCalled();
  });

  it("rejects an illegal review transition", async () => {
    const repo = {
      getCollaboration: vi.fn(),
      createSubmission: vi.fn(),
      getSubmissionById: vi
        .fn()
        .mockResolvedValue(submission({ status: "approved" })),
      updateSubmission: vi.fn(),
      landApprovedSubmission: vi.fn(),
    };

    await expect(
      reviewCollaborationSubmission({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor: hostActor,
        submissionId: "S-1",
        decision: "rejected",
      }),
    ).rejects.toThrow("Cannot move collaboration submission from approved to rejected");
  });
});
