import { describe, expect, it } from "vitest";

import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  type OrganizationBrandActor,
  type OrganizationBrandDraftRecord,
  type OrganizationBrandRepository,
  type OrganizationBrandSource,
} from "./organization-brand-service";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const INITIAL_REVISION = 7;

const ownerA: OrganizationBrandActor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Owner A",
  role: "owner",
  organizationId: ORGANIZATION_ID,
  organizationName: "Concurrent Brand Org",
};

const ownerB: OrganizationBrandActor = {
  ...ownerA,
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Owner B",
};

const initialContent: OrganizationBrandSource = {
  logoText: "CB",
  logoStoragePath: null,
  brandName: "Published Brand",
  brandTagline: "Before the race",
  primaryColor: "#123456",
};

describe("OrganizationBrandService concurrent draft CAS", () => {
  it("allows exactly one of two same-token saves and preserves the winner", async () => {
    const concurrentRepo = createConcurrentDraftRepository();
    const service = new OrganizationBrandService(concurrentRepo.repo);
    const requestA = draftRequest("Owner A draft");
    const requestB = draftRequest("Owner B draft");

    const race = await Promise.allSettled([
      service.saveBrandDraft(ownerA, requestA),
      service.saveBrandDraft(ownerB, requestB),
    ]);

    const fulfilled = race.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<OrganizationBrandService["saveBrandDraft"]>>
      > => result.status === "fulfilled",
    );
    const rejected = race.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(concurrentRepo.arrivals()).toEqual([
      { expectedVersion: 3, expectedDraftRevision: INITIAL_REVISION },
      { expectedVersion: 3, expectedDraftRevision: INITIAL_REVISION },
    ]);
    expect(concurrentRepo.arrivalsAtFirstCommit()).toBe(2);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = fulfilled[0].value;
    expect(winner.draftRevision).toBe(INITIAL_REVISION + 1);
    expect(concurrentRepo.commitCount()).toBe(1);
    expect(concurrentRepo.currentDraft()).toMatchObject({
      baseVersion: 3,
      draftRevision: INITIAL_REVISION + 1,
      content: winner.content,
    });

    const loser = rejected[0].reason;
    expect(loser).toBeInstanceOf(OrganizationBrandServiceError);
    expect(loser).toMatchObject({
      code: "BRAND_DRAFT_CONFLICT",
      status: 409,
      latestVersion: 3,
      latestDraftRevision: INITIAL_REVISION + 1,
    });
    const loserBrandName =
      winner.content.brandName === requestA.brandName
        ? requestB.brandName
        : requestA.brandName;
    expect(concurrentRepo.currentDraft().content).not.toMatchObject({
      brandName: loserBrandName,
    });
  });
});

function draftRequest(brandName: string) {
  return {
    expectedVersion: 3,
    expectedDraftRevision: INITIAL_REVISION,
    ...initialContent,
    brandName,
  };
}

function createConcurrentDraftRepository(): {
  repo: OrganizationBrandRepository;
  arrivals: () => Array<{
    expectedVersion: number;
    expectedDraftRevision: number;
  }>;
  arrivalsAtFirstCommit: () => number | null;
  commitCount: () => number;
  currentDraft: () => OrganizationBrandDraftRecord;
} {
  const barrier = createBarrier(2);
  const arrivals: Array<{
    expectedVersion: number;
    expectedDraftRevision: number;
  }> = [];
  let arrivalsAtFirstCommit: number | null = null;
  let commitCount = 0;
  let currentDraft: OrganizationBrandDraftRecord = {
    organizationId: ORGANIZATION_ID,
    baseVersion: 3,
    draftRevision: INITIAL_REVISION,
    content: initialContent,
    updatedAt: "2026-08-02T00:00:00.000Z",
    updatedBy: ownerA.userId,
  };

  const repo: OrganizationBrandRepository = {
    getOrganization: async () => ({
      id: ORGANIZATION_ID,
      name: "Concurrent Brand Org",
      branding: initialContent,
      brandingVersion: 3,
    }),
    getDraft: async () => structuredClone(currentDraft),
    listVersions: async () => [],
    saveDraft: async (input) => {
      arrivals.push({
        expectedVersion: input.expectedVersion,
        expectedDraftRevision: input.expectedDraftRevision,
      });
      await barrier.arrive();

      if (input.expectedVersion !== currentDraft.baseVersion) {
        throw { code: "40001", message: "brand_version_conflict" };
      }
      if (input.expectedDraftRevision !== currentDraft.draftRevision) {
        throw { code: "40001", message: "brand_draft_conflict" };
      }

      arrivalsAtFirstCommit ??= arrivals.length;
      currentDraft = {
        organizationId: ORGANIZATION_ID,
        baseVersion: input.expectedVersion,
        draftRevision: input.expectedDraftRevision + 1,
        content: structuredClone(input.content),
        updatedAt: `2026-08-02T00:00:0${commitCount + 1}.000Z`,
      };
      commitCount += 1;
      return structuredClone(currentDraft);
    },
    publishBrand: async () => {
      throw new Error("not used");
    },
    listContactCards: async () => [],
    getContactCard: async () => null,
    createContactCard: async () => {
      throw new Error("not used");
    },
    updateContactCard: async () => {
      throw new Error("not used");
    },
    emergencyRemoveContactCard: async () => {
      throw new Error("not used");
    },
  };

  return {
    repo,
    arrivals: () => structuredClone(arrivals),
    arrivalsAtFirstCommit: () => arrivalsAtFirstCommit,
    commitCount: () => commitCount,
    currentDraft: () => structuredClone(currentDraft),
  };
}

function createBarrier(parties: number): { arrive: () => Promise<void> } {
  let arrived = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    arrive: async () => {
      arrived += 1;
      if (arrived === parties) {
        release?.();
      }
      await ready;
    },
  };
}
