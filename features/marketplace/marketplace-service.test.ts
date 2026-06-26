import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmDeal,
  publishPosting,
  reviewApplication,
  submitApplication,
  MarketplaceError,
  type MarketplaceActor,
  type RepoPort,
} from "./marketplace-service";
import type { ApplicationPublic, PostingPublic } from "./marketplace-types";

const NOW = "2026-06-27T00:00:00.000Z";

function makePosting(over: Partial<PostingPublic> = {}): PostingPublic {
  return {
    id: "post-1",
    organizationId: "org-owner",
    postType: "demand",
    status: "open",
    title: "需求甲",
    productName: null,
    category: null,
    budgetCents: null,
    settlementMethod: null,
    requirements: null,
    description: null,
    deadlineAt: null,
    details: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeApplication(over: Partial<ApplicationPublic> = {}): ApplicationPublic {
  return {
    id: "app-1",
    postingId: "post-1",
    applicantOrganizationId: "org-mcn",
    status: "submitted",
    streamerLineup: null,
    pastCases: null,
    quoteCents: null,
    resources: null,
    message: null,
    reviewNote: null,
    submittedAt: NOW,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeRepo(seed: { posting?: PostingPublic; application?: ApplicationPublic } = {}) {
  const state = {
    posting: seed.posting ?? makePosting(),
    application: seed.application ?? null,
  };
  const repo: RepoPort = {
    getPostingById: vi.fn(async (id) => (id === state.posting.id ? state.posting : null)),
    createPosting: vi.fn(async (input) => {
      state.posting = makePosting({ id: "post-new", ...input } as Partial<PostingPublic>);
      return state.posting;
    }),
    upsertPostingPrivate: vi.fn(async () => {}),
    updatePostingStatus: vi.fn(async (id, status) => {
      state.posting = makePosting({ ...state.posting, status: status as PostingPublic["status"] });
    }),
    getApplicationById: vi.fn(async (id) =>
      state.application && id === state.application.id ? state.application : null,
    ),
    createApplication: vi.fn(async (input) => {
      state.application = makeApplication({ id: "app-new", ...input } as Partial<ApplicationPublic>);
      return state.application;
    }),
    updateApplication: vi.fn(async (id, patch) => {
      state.application = makeApplication({ ...(state.application ?? makeApplication()), ...patch, id });
      return state.application;
    }),
    upsertApplicationPrivate: vi.fn(async () => {}),
    createDeal: vi.fn(async (input) => ({
      id: "deal-1",
      postingId: input.postingId,
      applicationId: input.applicationId,
      ownerOrganizationId: input.ownerOrganizationId,
      applicantOrganizationId: input.applicantOrganizationId,
      status: "pending_collaboration" as const,
      collaborationApplicationId: null,
      collaborationAgreementId: null,
      collaborationShareId: null,
      collaborationShareToken: null,
      createdAt: NOW,
    })),
  };
  return { repo, state };
}

const ownerActor: MarketplaceActor = {
  userId: "u-owner",
  name: "Owner",
  role: "owner",
  organizationId: "org-owner",
};
const mcnActor: MarketplaceActor = {
  userId: "u-mcn",
  name: "MCN",
  role: "ops_manager",
  organizationId: "org-mcn",
};
const streamerActor: MarketplaceActor = {
  userId: "u-s",
  role: "streamer",
  organizationId: "org-mcn",
};

const audit = vi.fn();

describe("marketplace-service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes a posting (open) and writes private contact + audit", async () => {
    const { repo } = makeRepo();
    const posting = await publishPosting(repo, audit, ownerActor, {
      title: "求主播带量",
      budgetCents: 50000,
      contact: "微信 abc",
    });
    expect(posting.status).toBe("open");
    expect(repo.upsertPostingPrivate).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledOnce();
  });

  it("blocks streamers and empty titles", async () => {
    const { repo } = makeRepo();
    await expect(publishPosting(repo, audit, streamerActor, { title: "x" })).rejects.toThrow(
      MarketplaceError,
    );
    await expect(publishPosting(repo, audit, ownerActor, { title: "  " })).rejects.toThrow(
      /title is required/,
    );
  });

  it("submits an application but rejects applying to own posting / closed posting", async () => {
    const { repo } = makeRepo();
    const app = await submitApplication(repo, audit, mcnActor, "post-1", { quoteCents: 30000 }, NOW);
    expect(app.status).toBe("submitted");

    await expect(
      submitApplication(repo, audit, ownerActor, "post-1", {}, NOW),
    ).rejects.toThrow(/own posting/);

    const closed = makeRepo({ posting: makePosting({ status: "closed" }) });
    await expect(
      submitApplication(closed.repo, audit, mcnActor, "post-1", {}, NOW),
    ).rejects.toThrow(/not open/);
  });

  it("lets the owner review and the applicant confirm the deal", async () => {
    const { repo, state } = makeRepo({ application: makeApplication({ status: "submitted" }) });

    const approved = await reviewApplication(repo, audit, ownerActor, "app-1", "approve", "OK", NOW);
    expect(approved.status).toBe("approved");

    // 非发单方不能审核
    await expect(
      reviewApplication(repo, audit, mcnActor, "app-1", "approve", null, NOW),
    ).rejects.toThrow(/posting owner/);

    state.application = makeApplication({ status: "approved" });
    const deal = await confirmDeal(repo, audit, mcnActor, "app-1");
    expect(deal.status).toBe("pending_collaboration");
    expect(repo.updatePostingStatus).toHaveBeenCalledWith("post-1", "matched");
  });

  it("rejects confirming a non-approved application and non-applicant actor", async () => {
    const { repo, state } = makeRepo({ application: makeApplication({ status: "submitted" }) });
    await expect(confirmDeal(repo, audit, mcnActor, "app-1")).rejects.toThrow(/approved/);

    state.application = makeApplication({ status: "approved" });
    await expect(confirmDeal(repo, audit, ownerActor, "app-1")).rejects.toThrow(/applicant/);
  });
});
