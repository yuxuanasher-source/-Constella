import { beforeEach, describe, expect, it, vi } from "vitest";

import * as ctx from "@/features/marketplace/marketplace-route-utils";
import type { RepoPort } from "@/features/marketplace/marketplace-service";
import type {
  ApplicationPublic,
  PostingPublic,
} from "@/features/marketplace/marketplace-types";

vi.mock("@/features/marketplace/marketplace-route-utils", async () => {
  const actual = await vi.importActual<typeof ctx>(
    "@/features/marketplace/marketplace-route-utils",
  );
  return { ...actual, getMarketplaceContext: vi.fn() };
});

const NOW = "2026-06-27T00:00:00.000Z";

// 简单内存仓储，驱动真实 service 走完整链路。
function makeRepo() {
  const postings = new Map<string, PostingPublic>();
  const applications = new Map<string, ApplicationPublic>();
  let seq = 0;
  const repo: RepoPort & {
    listPublicPostings: (f: unknown) => Promise<PostingPublic[]>;
    listMyPostings: (o: string) => Promise<PostingPublic[]>;
    listMyApplications: (o: string) => Promise<ApplicationPublic[]>;
    listApplicationsForPosting: (p: string) => Promise<ApplicationPublic[]>;
  } = {
    getPostingById: async (id) => postings.get(id) ?? null,
    listPublicPostings: async () =>
      [...postings.values()].filter((p) => p.status === "open" || p.status === "matched"),
    listMyPostings: async (org) =>
      [...postings.values()].filter((p) => p.organizationId === org),
    createPosting: async (input) => {
      const id = `post-${++seq}`;
      const row: PostingPublic = {
        id,
        organizationId: input.organizationId,
        postType: input.postType,
        status: input.status,
        title: input.title,
        productName: input.productName,
        category: input.category,
        budgetCents: input.budgetCents,
        settlementMethod: input.settlementMethod,
        requirements: input.requirements,
        description: input.description,
        deadlineAt: input.deadlineAt,
        details: input.details,
        createdAt: NOW,
        updatedAt: NOW,
      };
      postings.set(id, row);
      return row;
    },
    upsertPostingPrivate: async () => {},
    updatePostingStatus: async (id, status) => {
      const p = postings.get(id);
      if (p) postings.set(id, { ...p, status: status as PostingPublic["status"] });
    },
    getApplicationById: async (id) => applications.get(id) ?? null,
    listApplicationsForPosting: async (postingId) =>
      [...applications.values()].filter((a) => a.postingId === postingId),
    listMyApplications: async (org) =>
      [...applications.values()].filter((a) => a.applicantOrganizationId === org),
    createApplication: async (input) => {
      const id = `app-${++seq}`;
      const row: ApplicationPublic = {
        id,
        postingId: input.postingId,
        applicantOrganizationId: input.applicantOrganizationId,
        status: input.status,
        streamerLineup: input.streamerLineup,
        pastCases: input.pastCases,
        quoteCents: input.quoteCents,
        resources: input.resources,
        message: input.message,
        reviewNote: null,
        submittedAt: input.submittedAt,
        reviewedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      applications.set(id, row);
      return row;
    },
    updateApplication: async (id, patch) => {
      const a = applications.get(id)!;
      const row = { ...a, ...(patch as Partial<ApplicationPublic>) };
      applications.set(id, row);
      return row;
    },
    upsertApplicationPrivate: async () => {},
    createDeal: async (input) => ({
      id: "deal-1",
      postingId: input.postingId,
      applicationId: input.applicationId,
      ownerOrganizationId: input.ownerOrganizationId,
      applicantOrganizationId: input.applicantOrganizationId,
      status: "pending_collaboration" as const,
      collaborationApplicationId: null,
      collaborationAgreementId: null,
      createdAt: NOW,
    }),
  };
  return repo;
}

const sharedRepo = makeRepo();

function asActor(role: string, org: string) {
  return {
    auth: { organizationId: org, userId: `u-${org}`, name: org, role },
    repo: sharedRepo,
    audit: vi.fn(),
    actor: { userId: `u-${org}`, name: org, role, organizationId: org },
  };
}

function jsonReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/marketplace", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("marketplace API end-to-end (publish → submit → review → confirm)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a streamer publishing", async () => {
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue(
      asActor("streamer", "org-owner") as never,
    );
    const { POST } = await import("./route");
    const res = await POST(jsonReq({ title: "x" }));
    expect(res.status).toBe(403);
  });

  it("runs the full happy path across route handlers", async () => {
    // 1) 发单方发布
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue(
      asActor("owner", "org-owner") as never,
    );
    const { POST: publish, GET: listPublic } = await import("./route");
    const pubRes = await publish(jsonReq({ title: "求带量主播", budgetCents: 50000 }));
    expect(pubRes.status).toBe(200);
    const postingId = (await pubRes.json()).posting.id;

    // 公开列表可见
    const listRes = await listPublic(new Request("http://localhost/api/marketplace/postings"));
    expect((await listRes.json()).postings.length).toBeGreaterThan(0);

    // 2) 接单方投递
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue(
      asActor("ops_manager", "org-mcn") as never,
    );
    const { POST: submit } = await import("../postings/[id]/applications/route");
    const subRes = await submit(jsonReq({ quoteCents: 30000 }), {
      params: Promise.resolve({ id: postingId }),
    });
    expect(subRes.status).toBe(200);
    const appId = (await subRes.json()).application.id;

    // 3) 发单方审核通过
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue(
      asActor("owner", "org-owner") as never,
    );
    const { POST: review } = await import("../applications/[id]/review/route");
    const revRes = await review(jsonReq({ action: "approve", note: "OK" }), {
      params: Promise.resolve({ id: appId }),
    });
    expect(revRes.status).toBe(200);
    expect((await revRes.json()).application.status).toBe("approved");

    // 4) 接单方确认达成
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue(
      asActor("ops_manager", "org-mcn") as never,
    );
    const { POST: confirm } = await import("../applications/[id]/confirm/route");
    const confRes = await confirm(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: appId }),
    });
    expect(confRes.status).toBe(200);
    expect((await confRes.json()).deal.status).toBe("pending_collaboration");

    // 需求转 matched
    const posting = await sharedRepo.getPostingById(postingId);
    expect(posting?.status).toBe("matched");
  });
});
